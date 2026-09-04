import type { Messages } from '../merge.js';

/**
 * Billing — plan and seats, meters, API packs, invoices, payment method (I18N-g, tm 133.7).
 *
 * The mock-billing honesty text ("nothing is charged", "no card is charged") is translated
 * along with everything else — the surface exists to make the metered pricing legible, and
 * that includes the reassurance that none of it is real money yet (ADR-13).
 */
export const billing: Messages = {
  // Page shell — BillingPage.tsx
  'billing.page.title': 'Billing',
  'billing.page.loadError':
    'Could not load billing. Check that the API is reachable and try again.',
  'billing.page.description': 'Plan, usage and charges for period {period}.',
  'billing.page.providerNotice':
    'Payment provider: {provider}. No external charge is made — usage figures and the arithmetic above are real.',

  // Read-only banner (trial expired)
  'billing.readOnly.title': 'This workspace is read-only.',
  'billing.readOnly.description':
    'The trial has ended. Existing conversations stay readable and exportable and nothing has been deleted — but new conversations cannot be started until a plan is active.',

  // Trial status banner
  'billing.trial.daysLeft.one': '{count} day left in your trial',
  'billing.trial.daysLeft.other': '{count} days left in your trial',
  'billing.trial.notice': 'Nothing is billed during the trial.',
  'billing.trial.noticeWithEnd': 'Nothing is billed during the trial, which ends on {date}.',

  // Plan section
  'billing.plan.title': 'Plan',
  'billing.plan.kpi.plan': 'Plan',
  'billing.plan.kpi.seats': 'Seats',
  'billing.plan.kpi.seatsHint': '{price} per seat',
  'billing.plan.kpi.estimatedTotal': 'Estimated total',
  'billing.plan.kpi.estimatedTotalHintTrial': 'Nothing billed during the trial',
  'billing.plan.kpi.estimatedTotalHintPeriod': 'This period',
  'billing.plan.kpi.status': 'Status',

  // Manage plan — ManagePlan
  'billing.managePlan.title': 'Manage plan',
  'billing.managePlan.description':
    'Billing is mocked — nothing is charged. Changes save as you make them.',
  'billing.managePlan.cycleLabel': 'Billing cycle',
  'billing.managePlan.monthly': 'Monthly',
  'billing.managePlan.annual': 'Annual',
  'billing.managePlan.annualSaveHint': '· save {amount}/yr',
  'billing.managePlan.seatsLabel': 'Seats',
  'billing.managePlan.removeSeat': 'Remove a seat',
  'billing.managePlan.addSeat': 'Add a seat',
  'billing.managePlan.pricePerUser': '{price} / user / month',
  'billing.managePlan.minSeatsNotice':
    'Minimum {min} — you cannot buy fewer seats than your active agents.',
  'billing.managePlan.billedNowPrefix': 'Billed now',
  'billing.managePlan.billedNowSuffix': 'during the trial.',
  'billing.managePlan.afterTrialPrefix': 'After the trial:',
  'billing.managePlan.totalPrefix': 'Total:',
  'billing.managePlan.cycleUnit.month': 'month',
  'billing.managePlan.cycleUnit.year': 'year',
  'billing.managePlan.annualSavingsNotice': 'Saving {amount} a year versus monthly billing.',

  // AI resolutions meter
  'billing.aiMeter.title': 'AI resolutions',
  'billing.aiMeter.description': 'A conversation an AI closed without a human ever replying.',
  'billing.aiMeter.pastIncluded': 'Past your included AI resolutions',
  'billing.aiMeter.percentUsedWarning': 'You have used {percent}% of your AI resolutions',
  'billing.aiMeter.overageDetail':
    '{overage} beyond the included {included} this period. Each extra resolution bills at {price} — no surprise on the invoice.',
  'billing.aiMeter.usedDetail':
    '{used} of {included} used. Beyond the allowance, resolutions bill at {price} each.',
  'billing.aiMeter.percentUsed': '{percent}% used',
  'billing.aiMeter.overAllowance': 'Over the included allowance',
  'billing.aiMeter.nearingLimit': 'Nearing the limit',
  'billing.aiMeter.quotaBarAriaLabel': 'Included AI resolutions used',
  'billing.aiMeter.overageNotice':
    '{overage} beyond the included allowance — {amount} this period.',
  'billing.aiMeter.overagePackageTitle': 'Overage package',
  'billing.aiMeter.overagePackageDetail':
    'Beyond the included {included}, AI resolutions bill at {price} each — sold in packs of {unit} ({packPrice} per pack).',
  'billing.aiMeter.periodLabel': 'This period',

  // API calls
  'billing.apiCalls.title': 'API calls',
  'billing.apiCalls.description':
    'Requests your integrations make with a personal access token, metered per call.',
  'billing.apiCalls.used': 'Used',
  'billing.apiCalls.usedHint': 'of {included} included',
  'billing.apiCalls.included': 'Included',
  'billing.apiCalls.overage': 'Overage',
  'billing.apiCalls.overageCharge': 'Overage charge',
  'billing.apiCalls.overageChargeHint': 'this period',
  'billing.apiCalls.overageTerms':
    'Beyond the included {included}, API calls bill at {price} per {unit} — billed by the block.',

  // API packages — ApiPackagesSection, ApiPackageCard
  'billing.apiPackages.title': 'API packages',
  'billing.apiPackages.description':
    "One-off top-ups on top of your plan's included API calls. Billing is mocked (ADR-13) — buying a package charges no card.",
  'billing.apiPackages.loadError': 'Could not load the API package catalogue.',
  'billing.apiPackages.buyErrorTitle': 'Could not buy the package.',
  'billing.apiPackages.buyErrorDescription':
    'The purchase did not go through — your quota is unchanged. Try again.',
  'billing.apiPackages.empty': 'No API packages are available to buy right now.',
  'billing.apiPackages.callsUnit': 'calls',
  'billing.apiPackages.buyAriaLabel': 'Buy {name}',
  'billing.apiPackages.buy': 'Buy',
  'billing.apiPackages.confirmAriaLabel': 'Confirm buying {name}',
  'billing.apiPackages.confirmPurchase': 'Confirm purchase',
  'billing.apiPackages.buying': 'Buying…',
  'billing.apiPackages.cancel': 'Cancel',
  'billing.apiPackages.confirmPrompt': 'Buy {name} for {price}? No card is charged (mock billing).',

  // Purchase history — ApiPackagePurchasesSection
  'billing.purchaseHistory.title': 'Purchase history',
  'billing.purchaseHistory.description':
    'Every API package this workspace has bought, newest first.',
  'billing.purchaseHistory.loadError': 'Could not load the purchase history.',
  'billing.purchaseHistory.empty':
    'You have not bought an API package yet — buy one above to raise this period’s allowance.',
  'billing.purchaseHistory.table.date': 'Date',
  'billing.purchaseHistory.table.package': 'Package',
  'billing.purchaseHistory.table.quota': 'Quota',
  'billing.purchaseHistory.table.amount': 'Amount',

  // Payment method — PaymentMethodSection, PaymentMethodForm
  'billing.paymentMethod.title': 'Payment method',
  'billing.paymentMethod.description':
    'Billing is mocked — no card is charged and no full card number is collected.',
  'billing.paymentMethod.loadError': 'Could not load the payment method.',
  'billing.paymentMethod.empty': 'No payment method on file yet.',
  'billing.paymentMethod.ending': 'ending {last4}',
  'billing.paymentMethod.expires': '· expires {date}',
  'billing.paymentMethod.addButton': 'Add payment method',
  'billing.paymentMethod.updateButton': 'Update payment method',
  'billing.paymentMethod.readOnlyNotice':
    'You can still update your payment method while the workspace is read-only.',
  'billing.paymentMethod.form.brandLabel': 'Card brand',
  'billing.paymentMethod.form.last4Label': 'Last 4 digits',
  'billing.paymentMethod.form.last4Placeholder': '4242',
  'billing.paymentMethod.form.last4Error': 'Enter the last 4 digits — exactly 4 numbers.',
  'billing.paymentMethod.form.expiryLabel': 'Expiry',
  'billing.paymentMethod.form.expiryMonthLabel': 'Expiry month',
  'billing.paymentMethod.form.expiryYearLabel': 'Expiry year',
  'billing.paymentMethod.form.holderLabel': 'Cardholder name',
  'billing.paymentMethod.form.holderPlaceholder': 'Jane Doe',
  'billing.paymentMethod.form.holderRequiredError': 'Enter the cardholder name.',
  'billing.paymentMethod.form.saveError': 'Could not save the payment method. Check the details.',
  'billing.paymentMethod.form.stripeNotice':
    'A real Stripe card element would mount here. Only the masked details are stored.',
  'billing.paymentMethod.form.save': 'Save',
  'billing.paymentMethod.form.saving': 'Saving…',
  'billing.paymentMethod.form.cancel': 'Cancel',

  // Invoices — InvoicesSection
  'billing.invoices.title': 'Invoices',
  'billing.invoices.loadingDescription': 'Your billing statements.',
  'billing.invoices.description': 'Your billing statements, newest first.',
  'billing.invoices.loadError': 'Could not load invoices.',
  'billing.invoices.table.invoice': 'Invoice',
  'billing.invoices.table.issued': 'Issued',
  'billing.invoices.table.status': 'Status',
  'billing.invoices.table.amount': 'Amount',
  'billing.invoices.table.download': 'Download',
  'billing.invoices.downloadAriaLabel': 'Download invoice {number}',
  'billing.invoices.downloading': 'Downloading…',
  'billing.invoices.status.paid': 'Paid',
  'billing.invoices.status.open': 'Open',
  'billing.invoices.status.trial': 'Trial',
};
