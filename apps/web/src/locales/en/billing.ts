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

  // Only the owner changes the bill (K7)
  'billing.ownerOnly.title': 'Only the Owner can change billing.',
  'billing.ownerOnly.description':
    'You can see the plan, usage, invoices and payment method. Changing the plan, seats or payment method and buying packages is up to the Owner.',

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
  'billing.plan.name.growth': 'Growth',
  'billing.plan.name.enterprise': 'Enterprise',
  'billing.plan.cycle.monthly': 'Monthly',
  'billing.plan.cycle.annual': 'Annual',
  'billing.plan.statusValue.trialing': 'Trial',
  'billing.plan.statusValue.active': 'Active',
  'billing.plan.statusValue.past_due': 'Past due',
  'billing.plan.statusValue.canceled': 'Canceled',
  'billing.plan.statusValue.suspended': 'Suspended',
  'billing.provider.mock': 'Demo billing',

  // Manage plan — ManagePlan
  'billing.managePlan.title': 'Manage plan',
  'billing.managePlan.description':
    'Billing is mocked — nothing is charged. Changes save as you make them.',

  // Plan tier — PlanSelector
  'billing.managePlan.plan.label': 'Plan tier',
  'billing.managePlan.plan.loading': 'Loading plans…',
  'billing.managePlan.plan.loadError': 'Could not load the plan catalogue.',
  'billing.managePlan.plan.genericError': 'Could not change the plan. Try again.',
  // The server's refusals of a plan change, by their stable `details.reason`
  // (lib/reason-message.ts, tm 259.18).
  'billing.reason.plan_below_usage':
    'The {plan} plan includes {included} AI resolutions — below the {used} already used this month.',
  'billing.reason.seats_below_active':
    'Seats cannot be fewer than the {active_agents} active agent(s) on this workspace.',
  'billing.reason.plan_unknown': 'That plan is not available.',
  'billing.reason.cycle_unknown': 'That billing cycle is not available.',
  'billing.managePlan.plan.overQuotaReason':
    'The {plan} plan includes {included} AI resolutions — below the {used} already used this period.',
  'billing.managePlan.plan.confirmListed':
    'Switch to the {plan} plan for {price} / {cycle}? This takes effect immediately.',
  'billing.managePlan.plan.confirmQuoted':
    "Switch to the {plan} plan? Its price is set in your contract, so today's charges stay the same until that changes. This takes effect immediately.",
  'billing.managePlan.plan.confirmButton': 'Confirm plan change',
  'billing.managePlan.plan.confirming': 'Switching…',
  'billing.managePlan.plan.cancelButton': 'Cancel',

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
  // Buying overage packs — BuyOveragePacks (FR-MOD-10.1.4)
  'billing.aiMeter.buyPacksLabel': 'Buy overage packs',
  'billing.aiMeter.removePack': 'One pack fewer',
  'billing.aiMeter.addPack': 'One pack more',
  'billing.aiMeter.packTotal': '{resolutions} resolutions for {amount}',
  'billing.aiMeter.buyPacks': 'Buy packs',
  'billing.aiMeter.buying': 'Buying…',
  'billing.aiMeter.buyPacksNotice':
    'Added to this period’s allowance straight away and itemised on this period’s invoice. No card is charged (mock billing).',
  'billing.aiMeter.bought': 'Bought — {resolutions} resolutions added to this period.',
  'billing.aiMeter.buyErrorTitle': 'Could not buy the packs.',
  'billing.aiMeter.buyErrorDescription':
    'The purchase did not go through — your allowance is unchanged. Try again.',
  'billing.aiMeter.packTermsError':
    'Could not load the overage pack terms — buying is unavailable.',

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
    "One-off top-ups on top of your plan's included API calls. Billing is mocked — buying a package charges no card.",
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
  'billing.invoices.downloadError': "Couldn't download invoice {number}.",
  'billing.invoices.table.invoice': 'Invoice',
  'billing.invoices.table.issued': 'Issued',
  'billing.invoices.table.status': 'Status',
  'billing.invoices.table.amount': 'Amount',
  'billing.invoices.table.download': 'Download',
  'billing.invoices.downloadAriaLabel': 'Download invoice {number}',
  'billing.invoices.downloading': 'Downloading…',
  'billing.invoices.downloadPdf': 'PDF',
  'billing.invoices.downloadPdfAriaLabel': 'Download invoice {number} as PDF',
  'billing.profile.title': 'Billing details',
  'billing.profile.description':
    'The company name, address and tax numbers printed on your invoices.',
  'billing.profile.loadError': "Couldn't load your billing details.",
  'billing.profile.saveError': "Couldn't save your billing details. Try again.",
  'billing.profile.missing.title': 'No billing details yet',
  'billing.profile.missing.owner':
    'Invoices are issued under the workspace name until you add your company details.',
  'billing.profile.missing.reader':
    'Invoices are issued under the workspace name until the owner adds the company details.',
  'billing.profile.addButton': 'Add billing details',
  'billing.profile.editButton': 'Edit billing details',
  'billing.profile.summary.address': 'Address',
  'billing.profile.field.legalName': 'Legal name',
  'billing.profile.field.addressLine1': 'Address',
  'billing.profile.field.addressLine2': 'Address line 2 (optional)',
  'billing.profile.field.city': 'City',
  'billing.profile.field.postalCode': 'Postal code (optional)',
  'billing.profile.field.country': 'Country',
  'billing.profile.field.taxOffice': 'Tax office (optional)',
  'billing.profile.field.taxId': 'Tax number',
  'billing.profile.field.vatId': 'VAT number (optional)',
  'billing.profile.field.invoiceEmail': 'Invoice e-mail (optional)',
  'billing.profile.form.snapshotNotice':
    'Saved details appear on the next invoice. Invoices already issued keep the details they were issued with.',
  'billing.profile.form.chooseCountry': 'Choose a country',
  'billing.profile.form.taxIdHint':
    'Required for Türkiye: a 10-digit tax number or an 11-digit ID number.',
  'billing.profile.form.vatIdHint': 'Starts with the two-letter country code, e.g. DE123456789.',
  'billing.profile.form.save': 'Save details',
  'billing.profile.form.saving': 'Saving…',
  'billing.profile.form.cancel': 'Cancel',
  'billing.profile.error.required': 'Required.',
  'billing.profile.error.tooLong': 'At most {max} characters.',
  'billing.profile.error.invalid': 'This value is not accepted.',
  'billing.profile.error.country': 'Choose a country.',
  'billing.profile.error.taxIdInvalid':
    'Not a valid tax number for this country. Türkiye: 10 digits, or an 11-digit ID number.',
  'billing.profile.error.taxIdRequired': 'A company in Türkiye needs a tax number.',
  'billing.profile.error.vatId': 'A VAT number starts with a two-letter country code.',
  'billing.profile.error.email': 'Enter an e-mail address.',
  'billing.invoices.status.paid': 'Paid',
  'billing.invoices.status.open': 'Open',
  'billing.invoices.status.trial': 'Trial',
  'billing.invoices.origin.estimate': 'Estimate',
  'billing.invoices.origin.estimateHint':
    'This period is still running, so the figures move with usage. It becomes a statement when the month closes.',
  'billing.invoices.origin.reconstructed': 'Reconstructed',
  'billing.invoices.origin.reconstructedHint':
    'Frozen after the period closed. Metered lines and purchases carry their own prices and are exact; the seat charge was priced from the subscription as it stood when this was written.',

  // Paying — PaymentMethods.tsx (tm 382)
  'billing.payments.title': 'Pay for your subscription',
  'billing.payments.description':
    'Choose how to pay for the next term. The amount is the same whichever way you pay.',
  'billing.payments.loadError': 'Could not load the payment options.',
  'billing.payments.amountDue': 'Amount due for one {cycle} term: {amount} (seats: {seats}).',
  'billing.payments.quoted':
    'Your plan is invoiced under its contract, so there is nothing to pay here.',
  'billing.payments.paidThrough': 'Paid through {date}.',
  'billing.payments.noMethods': 'No way to pay is available right now. Contact SiyahTuş support.',
  'billing.payments.tablistLabel': 'How to pay',
  'billing.payments.method.swift_manual': 'Bank transfer',
  'billing.payments.method.crypto_manual': 'Crypto (USDT)',
  'billing.payments.method.stripe': 'Card',
  'billing.payments.cycle.monthly': 'monthly',
  'billing.payments.cycle.annual': 'annual',
  'billing.payments.swift.beneficiary': 'Beneficiary',
  'billing.payments.swift.bank': 'Bank',
  'billing.payments.swift.iban': 'IBAN',
  'billing.payments.swift.bic': 'SWIFT/BIC',
  'billing.payments.swift.address': 'Bank address',
  'billing.payments.swift.noBank':
    'The bank details are not set up yet — the SiyahTuş team will send them with your reference.',
  'billing.payments.swift.referenceLabel': 'Transfer reference',
  'billing.payments.swift.instructions':
    'Transfer {amount} and write this reference in the description. The SiyahTuş team marks the transfer paid when it arrives, and your subscription is active from then.',
  'billing.payments.swift.issueButton': 'Get a transfer reference',
  'billing.payments.swift.issuing': 'Getting a reference…',
  'billing.payments.crypto.loadError': 'Could not load your crypto payment requests.',
  'billing.payments.crypto.status.requested': 'Address requested',
  'billing.payments.crypto.status.address_sent': 'Address sent',
  'billing.payments.crypto.status.paid': 'Paid',
  'billing.payments.crypto.status.rejected': 'Rejected',
  'billing.payments.crypto.status.canceled': 'Withdrawn',
  'billing.payments.crypto.network.usdt_trc20': 'USDT on TRON (TRC-20)',
  'billing.payments.crypto.network.usdt_erc20': 'USDT on Ethereum (ERC-20)',
  'billing.payments.crypto.waitingForAddress':
    'The SiyahTuş team will send a wallet address here. No address is shown automatically.',
  'billing.payments.crypto.sendExactly':
    'Send exactly {amount} on {network} to this address, then enter the transaction ID.',
  'billing.payments.crypto.txidSubmitted':
    'Transaction {txid} submitted — the SiyahTuş team is confirming it.',
  'billing.payments.crypto.txidLabel': 'Transaction ID (TXID)',
  'billing.payments.crypto.submitTxid': 'Submit transaction ID',
  'billing.payments.crypto.replaceTxid': 'Replace transaction ID',
  'billing.payments.crypto.withdraw': 'Withdraw request',
  'billing.payments.crypto.formLabel': 'Request a crypto address',
  'billing.payments.crypto.intro':
    'Pay {amount}. Ask for a wallet address and the SiyahTuş team sends one for this request — no address is shown automatically.',
  'billing.payments.crypto.networkLabel': 'Network',
  'billing.payments.crypto.billingNameLabel': 'Billing name',
  'billing.payments.crypto.billingDetailsLabel': 'Billing details (address, tax number)',
  'billing.payments.crypto.requestButton': 'Request an address',
  'billing.payments.crypto.noRequest': 'No crypto payment has been requested.',
  'billing.payments.card.intro':
    "Pay {amount} on the card processor's secure page. Your card is saved there for renewals; SiyahTuş never sees your card number.",
  'billing.payments.card.payButton': 'Pay with card',
  'billing.payments.card.redirecting': 'Opening the payment page…',
  'billing.payments.band.pastDueTitle': "Your payment didn't go through",
  'billing.payments.band.pastDueBody':
    'We will try your card again on {retry}. If it still fails, the workspace becomes read-only on {readOnly}. You can pay another way below.',
  'billing.payments.band.noRetry': 'the last retry date',
  'billing.payments.band.failedTitle': "Your last payment didn't go through",
  'billing.payments.band.failedBody':
    'Payment {reference} failed. Try again or choose another way to pay below.',
  'billing.payments.band.returnedSuccessTitle': 'Payment received',
  'billing.payments.band.returnedSuccessBody':
    'Your card payment is being confirmed. This page shows it once the processor confirms it.',
  'billing.payments.band.returnedCanceled': 'The card payment was cancelled. Nothing was charged.',
  'billing.payments.errors.method_unavailable': 'This way to pay is not available.',
  'billing.payments.errors.quoted_plan': 'Your plan is invoiced under its contract.',
  'billing.payments.errors.request_open': 'A crypto request is already open.',
  'billing.payments.errors.reference_issued':
    'A reference was just issued — reload the page to see it.',
  'billing.payments.errors.txid_invalid': 'That is not a transaction ID on this network.',
  'billing.payments.errors.txid_used': 'This transaction ID has already been submitted.',
  'billing.payments.errors.not_awaiting_txid': 'This request is not waiting for a transaction ID.',
  'billing.payments.errors.not_cancellable': 'This request is already closed.',
  'billing.payments.errors.payment_provider_unavailable':
    'The card processor could not be reached. Try again.',
  'billing.payments.history.title': 'Payment history',
  'billing.payments.history.loadError': 'Could not load the payment history.',
  'billing.payments.history.empty': 'No payments yet.',
  'billing.payments.history.date': 'Date',
  'billing.payments.history.method': 'Method',
  'billing.payments.history.reference': 'Reference',
  'billing.payments.history.status': 'Outcome',
  'billing.payments.history.amount': 'Amount',
  'billing.payments.history.statusValue.pending': 'Waiting',
  'billing.payments.history.statusValue.succeeded': 'Succeeded',
  'billing.payments.history.statusValue.failed': 'Failed',
  'billing.payments.history.statusValue.canceled': 'Not completed',
  'billing.payments.history.statusValue.disputed': 'Disputed',
  'billing.payments.history.term': 'Covers {from} – {to}',

  // Cancelling the subscription — CancelSubscription.tsx (tm 384)
  'billing.cancel.title': 'Cancel subscription',
  'billing.cancel.description':
    'The subscription ends with the current period. Everything keeps working until then.',
  'billing.cancel.open': 'Cancel subscription',
  'billing.cancel.scheduled':
    'The subscription ends on {date}. Everything keeps working until then.',
  'billing.cancel.resume': 'Undo cancellation',
  'billing.cancel.ended.title': 'The subscription has ended',
  'billing.cancel.ended.exportUntil':
    'The workspace is read-only. You can read and export its data until {date}; after that nobody can sign in.',
  'billing.cancel.ended.deletionAt':
    "Following the workspace's retention setting, its data is deleted on {date}.",
  'billing.cancel.ended.kept':
    'The workspace keeps its conversations without limit, so its data is not deleted automatically.',
  'billing.cancel.ended.exportReports': 'Export reports',
  'billing.cancel.ended.exportArchive': 'Download conversations from the archive',
  'billing.cancel.dialog.title': 'Cancel the subscription?',
  'billing.cancel.dialog.reason': 'Why are you cancelling?',
  'billing.cancel.dialog.consequences': 'What happens next',
  'billing.cancel.dialog.untilPeriodEnd':
    'Everything keeps working until the end of the current period.',
  'billing.cancel.dialog.readOnly': 'When the period ends, the workspace becomes read-only.',
  'billing.cancel.dialog.export': 'You can read and export its data for 30 days after that.',
  'billing.cancel.dialog.deletion':
    'Then the data is deleted following the workspace’s retention setting (longer if you chose a longer retention).',
  'billing.cancel.dialog.noRefund': 'The rest of the period is not refunded.',
  'billing.cancel.dialog.confirm': 'Type {name} to confirm',
  'billing.cancel.dialog.keep': 'Keep subscription',
  'billing.cancel.dialog.submit': 'Cancel at period end',
  'billing.cancel.reason.too_expensive': 'It is too expensive',
  'billing.cancel.reason.missing_features': 'A feature we need is missing',
  'billing.cancel.reason.switching_provider': 'We are moving to another product',
  'billing.cancel.reason.not_using': 'We do not use it enough',
  'billing.cancel.reason.business_closed': 'Our business is closing or pausing',
  'billing.cancel.reason.other': 'Something else',
  'billing.cancel.error.confirmation': 'The name does not match the workspace name.',
  'billing.cancel.error.ended':
    'The subscription has already ended. Subscribing again is a new purchase.',
  'billing.cancel.error.noSubscription': 'This workspace has no subscription to cancel.',
  'billing.cancel.error.generic': 'The change could not be saved. Try again.',
};
