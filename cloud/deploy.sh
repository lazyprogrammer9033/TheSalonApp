#!/usr/bin/env bash
# Put The Salon App demo online on Google Cloud, inside the free tier, with a
# $1 budget and an automatic kill switch.
#
# Run it in Google Cloud Shell (https://shell.cloud.google.com), which already
# has gcloud and git, signed in as you:
#
#   git clone -b claude/project-thread-f5ca4q https://github.com/lazyprogrammer9033/TheSalonApp.git
#   bash TheSalonApp/cloud/deploy.sh
#
# Safe to run again: it reuses what already exists and redeploys the app.
#
# What it sets up, all in ONE NEW project of its own (no existing project is touched):
#   1. Cloud Run service "salon-app" (us-east1, scales to zero, max 1 instance,
#      demo mode: manager / manager). Free tier: 2M requests, 180k vCPU-s,
#      360k GiB-s a month.
#   2. A budget of 1 (in your billing account's currency) with email alerts at
#      50%, 90% and 100%.
#   3. A kill switch: the budget posts to Pub/Sub; the "stop-billing" function
#      removes billing from the project when spend goes over 1, which stops
#      every paid service in it.
#   4. Artifact Registry cleanup so only the newest image is kept (stays under
#      the 0.5 GB free storage).
set -euo pipefail

REGION="${REGION:-us-east1}"
SERVICE="salon-app"
LIMIT="${LIMIT:-1}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

say() { printf '\n==> %s\n' "$*"; }

# ---------- project ----------
PROJECT_ID="${PROJECT_ID:-}"
if [ -z "$PROJECT_ID" ]; then
  PROJECT_ID="$(gcloud projects list --filter='labels.app=salon-app-demo' --format='value(projectId)' --limit=1)"
fi
if [ -z "$PROJECT_ID" ]; then
  PROJECT_ID="salon-app-demo-$(head -c4 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  say "Creating a new project: $PROJECT_ID"
  gcloud projects create "$PROJECT_ID" --name="The Salon App demo" --labels=app=salon-app-demo
else
  say "Using project: $PROJECT_ID"
fi
gcloud config set project "$PROJECT_ID" >/dev/null

# ---------- billing (needed even for the free tier) ----------
BILLING_ACCOUNT="${BILLING_ACCOUNT:-}"
if [ -z "$BILLING_ACCOUNT" ]; then
  BILLING_ACCOUNT="$(gcloud billing accounts list --filter='open=true' --format='value(name)' --limit=1 | sed 's#billingAccounts/##')"
fi
if [ -z "$BILLING_ACCOUNT" ]; then
  echo "No open billing account found. Open https://console.cloud.google.com/billing and"
  echo "upgrade / create one (a card is needed even for the free tier), then run this again."
  exit 1
fi
if [ "$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled)')" != "True" ]; then
  say "Linking billing account $BILLING_ACCOUNT"
  gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT"
fi

say "Turning on the services it needs (takes a minute)"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  pubsub.googleapis.com eventarc.googleapis.com cloudfunctions.googleapis.com \
  cloudbilling.googleapis.com billingbudgets.googleapis.com cloudresourcemanager.googleapis.com

# Own service accounts, so nothing depends on the default Compute Engine one.
ensure_sa() { gcloud iam service-accounts describe "$1@${PROJECT_ID}.iam.gserviceaccount.com" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "$1" --display-name="$2"; }
grant() { gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$1" --role="$2" --condition=None >/dev/null; }
ensure_sa salon-builder "Builds the app images"
ensure_sa salon-runtime "Runs the app (no extra access)"
ensure_sa salon-kill-switch "Budget kill switch"
BUILD_SA="salon-builder@${PROJECT_ID}.iam.gserviceaccount.com"
RUN_SA="salon-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
KILL_SA="salon-kill-switch@${PROJECT_ID}.iam.gserviceaccount.com"
for r in roles/run.builder roles/cloudbuild.builds.builder roles/logging.logWriter roles/artifactregistry.writer roles/storage.objectAdmin; do
  grant "$BUILD_SA" "$r"
done
# Lets the function remove billing from THIS project only (not the billing account),
# and lets the Pub/Sub trigger call it.
grant "$KILL_SA" roles/billing.projectManager
grant "$KILL_SA" roles/run.invoker
sleep 20  # new accounts and roles take a moment to apply

# ---------- kill switch first, so it guards everything after it ----------
TOPIC="salon-app-budget"
gcloud pubsub topics describe "$TOPIC" >/dev/null 2>&1 || gcloud pubsub topics create "$TOPIC"

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"

say "Deploying the kill switch function"
gcloud functions deploy stop-billing --gen2 --region="$REGION" --runtime=nodejs22 \
  --source="$HERE/kill-switch" --entry-point=stopBilling --trigger-topic="$TOPIC" \
  --service-account="$KILL_SA" --trigger-service-account="$KILL_SA" \
  --build-service-account="projects/$PROJECT_ID/serviceAccounts/$BUILD_SA" --set-env-vars="TARGET_PROJECT=$PROJECT_ID" \
  --memory=256Mi --max-instances=1 --quiet

say "Creating the budget ($LIMIT) with email alerts and the kill switch"
if [ -z "$(gcloud billing budgets list --billing-account="$BILLING_ACCOUNT" \
      --filter="displayName='Salon App demo limit'" --format='value(name)')" ]; then
  gcloud billing budgets create --billing-account="$BILLING_ACCOUNT" \
    --display-name="Salon App demo limit" --budget-amount="$LIMIT" \
    --filter-projects="projects/$PROJECT_NUMBER" \
    --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0 \
    --notifications-rule-pubsub-topic="projects/$PROJECT_ID/topics/$TOPIC"
fi

# ---------- the app ----------
say "Building and deploying the app (3-5 minutes the first time)"
gcloud run deploy "$SERVICE" --source="$ROOT" --region="$REGION" --allow-unauthenticated \
  --memory=512Mi --cpu=1 --min-instances=0 --max-instances=1 --concurrency=40 \
  --cpu-throttling --no-cpu-boost --timeout=60 --service-account="$RUN_SA" \
  --build-service-account="projects/$PROJECT_ID/serviceAccounts/$BUILD_SA" \
  --set-env-vars="HTTPS=0,SECURE_COOKIES=1,TRUST_PROXY=1,DATA_DIR=/tmp/salon-data" --quiet

# Keep only the newest image so storage stays inside the free 0.5 GB.
if gcloud artifacts repositories describe cloud-run-source-deploy --location="$REGION" >/dev/null 2>&1; then
  cat > /tmp/salon-cleanup.json <<'JSON'
[
  {"name": "keep-newest", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 1}},
  {"name": "delete-rest", "action": {"type": "Delete"}, "condition": {"tagState": "any"}}
]
JSON
  gcloud artifacts repositories set-cleanup-policies cloud-run-source-deploy --location="$REGION" \
    --policy=/tmp/salon-cleanup.json --no-dry-run --quiet >/dev/null
fi

URL="$(gcloud run services describe "$SERVICE" --region="$REGION" --format='value(status.url)')"
say "Done."
echo "  Live demo:  $URL   (sign in: manager / manager)"
echo "  Project:    $PROJECT_ID"
echo "  Budget:     $LIMIT, alerts at 50/90/100%, billing switched off automatically above it."
