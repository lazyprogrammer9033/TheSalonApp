'use strict';

// Budget kill switch for The Salon App demo.
//
// The project's $1 budget posts a message to a Pub/Sub topic every time it
// recalculates spend. When the cost so far is over the budget, this function
// removes the billing account from the project. Google then stops every paid
// service in the project (the app goes offline) so the bill cannot keep growing.
//
// To turn the app back on, re-link billing in the console:
//   Billing > My projects > (this project) > Change billing.

const functions = require('@google-cloud/functions-framework');
const { CloudBillingClient } = require('@google-cloud/billing');

const billing = new CloudBillingClient();
const projectId = process.env.TARGET_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
const projectName = `projects/${projectId}`;

functions.cloudEvent('stopBilling', async (event) => {
  const raw = event.data && event.data.message && event.data.message.data;
  if (!raw) return console.log('No budget data in the message; nothing to do.');
  const budget = JSON.parse(Buffer.from(raw, 'base64').toString());
  const cost = Number(budget.costAmount);
  const limit = Number(budget.budgetAmount);
  console.log(`Budget "${budget.budgetDisplayName}": spent ${cost} of ${limit} ${budget.currencyCode}.`);

  if (!(cost > limit)) return console.log('Under the limit. Leaving billing on.');

  try {
    const [info] = await billing.getProjectBillingInfo({ name: projectName });
    if (!info.billingEnabled) return console.log('Billing is already off.');
  } catch (e) {
    console.warn(`Could not read billing status (${e.message}); removing billing anyway.`);
  }

  await billing.updateProjectBillingInfo({
    name: projectName,
    projectBillingInfo: { billingAccountName: '' },
  });
  console.log(`Spend went over the limit. Billing removed from ${projectId}; all paid services are now stopped.`);
});
