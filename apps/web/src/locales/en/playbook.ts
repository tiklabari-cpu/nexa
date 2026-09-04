import type { Messages } from '../merge.js';

/**
 * Playbook — the skill template catalogue (NFR-I18N2).
 *
 * Keys are `playbook.template.<id>.name` / `.summary`, `<id>` matching
 * `SkillTemplate.id` in `features/playbook/templates.ts`. `instruction`/`steps`
 * are deliberately absent — see that file's module note.
 */
export const playbook: Messages = {
  'playbook.template.order-status.name': 'Where is my order?',
  'playbook.template.order-status.summary':
    'Collect the order number, tag it, and answer from your knowledge base.',
  'playbook.template.returns-policy.name': 'Returns policy',
  'playbook.template.returns-policy.summary':
    'Recognise a returns question and answer it from your indexed policy.',
  'playbook.template.business-hours.name': 'Opening hours',
  'playbook.template.business-hours.summary':
    'A fixed reply for “are you open?”, no knowledge base required.',
  'playbook.template.shipping-cost.name': 'Shipping costs',
  'playbook.template.shipping-cost.summary':
    'Answer shipping cost questions straight from your knowledge base.',
  'playbook.template.order-cancellation.name': 'Cancel an order',
  'playbook.template.order-cancellation.summary':
    'Collect the order number and route a cancellation request to support.',
  'playbook.template.payment-methods.name': 'Accepted payment methods',
  'playbook.template.payment-methods.summary':
    'Recognise a payment-methods question and answer it from your knowledge base.',
  'playbook.template.change-shipping-address.name': 'Change a shipping address',
  'playbook.template.change-shipping-address.summary':
    'Collect the order number and route an address change to support.',
  'playbook.template.warranty-coverage.name': 'Warranty coverage',
  'playbook.template.warranty-coverage.summary':
    'A fixed explanation of what your warranty covers, answered from your knowledge base.',
  'playbook.template.contact-support.name': 'How to reach us',
  'playbook.template.contact-support.summary':
    'A fixed reply with your contact channels, no knowledge base required.',
  'playbook.template.discount-code-issue.name': 'Discount code not working',
  'playbook.template.discount-code-issue.summary':
    'Collect the code and route it to support to sort out.',
  'playbook.template.delete-my-account.name': 'Delete my account',
  'playbook.template.delete-my-account.summary':
    'Recognise an account-deletion request and route it to the support team.',
  'playbook.template.greet-and-route.name': 'Greet and find the topic',
  'playbook.template.greet-and-route.summary':
    'Open warmly, then let the assistant answer from what it knows.',
  'playbook.template.collect-then-handover.name': 'Collect details, then hand over',
  'playbook.template.collect-then-handover.summary':
    'Ask for an email, summarise the chat, and pass it to a human team.',
  'playbook.template.troubleshoot-then-escalate.name': 'Troubleshoot, then escalate',
  'playbook.template.troubleshoot-then-escalate.summary':
    'Try a knowledge-based answer first, then summarise and hand over if that is not enough.',
  'playbook.template.angry-customer-deescalate.name': 'De-escalate an upset customer',
  'playbook.template.angry-customer-deescalate.summary':
    'Acknowledge the frustration, summarise the issue, and hand it to a senior agent.',
  'playbook.template.product-recommendation.name': 'Recommend a product',
  'playbook.template.product-recommendation.summary':
    'Ask what the customer needs, then answer with a recommendation from your knowledge base.',
  'playbook.template.onboarding-walkthrough.name': 'Guide a new user',
  'playbook.template.onboarding-walkthrough.summary':
    'Welcome a new user warmly, then answer their first questions from the knowledge base.',
  'playbook.template.billing-question-lookup.name': 'Answer a billing question',
  'playbook.template.billing-question-lookup.summary':
    'Tag billing questions and answer them from your knowledge base.',
  'playbook.template.cancel-subscription-handover.name': 'Cancel a subscription',
  'playbook.template.cancel-subscription-handover.summary':
    'Understand why, summarise it, and route the cancellation to the billing team.',
  'playbook.template.vip-customer-priority.name': 'Prioritise a VIP customer',
  'playbook.template.vip-customer-priority.summary':
    'Recognise a top-tier customer and route them straight to a senior agent.',
  'playbook.template.multilingual-greeting.name': 'Greet in the customer’s language',
  'playbook.template.multilingual-greeting.summary':
    'Recognise a Spanish greeting and reply in kind before answering.',
  'playbook.template.post-purchase-checkin.name': 'Check in after a purchase',
  'playbook.template.post-purchase-checkin.summary':
    'Ask how the product is working out, then answer from your knowledge base.',
  'playbook.template.shopify-order-lookup.name': 'Look up an order in Shopify',
  'playbook.template.shopify-order-lookup.summary':
    'Ask for the order number and check its status in your store.',
  'playbook.template.stripe-refund.name': 'Start a refund in Stripe',
  'playbook.template.stripe-refund.summary':
    'Take the order number and route the refund to the billing team.',
  'playbook.template.csat-followup.name': 'Ask for feedback',
  'playbook.template.csat-followup.summary':
    'Once things are resolved, summarise and ask how it went.',
  'playbook.template.paypal-refund.name': 'Start a refund in PayPal',
  'playbook.template.paypal-refund.summary':
    'Take the order number and send the PayPal refund to the billing team.',
  'playbook.template.salesforce-case-sync.name': 'Log a case in Salesforce',
  'playbook.template.salesforce-case-sync.summary':
    'Capture the details and file the issue as a case for the support team.',
  'playbook.template.klaviyo-abandoned-cart.name': 'Recover an abandoned cart',
  'playbook.template.klaviyo-abandoned-cart.summary':
    'Reply to a cart question and offer a hand finishing the purchase.',
  'playbook.template.recharge-subscription-pause.name': 'Pause a subscription in Recharge',
  'playbook.template.recharge-subscription-pause.summary':
    'Collect the subscription id and route the pause request to billing.',
  'playbook.template.calendly-book-a-call.name': 'Book a call in Calendly',
  'playbook.template.calendly-book-a-call.summary':
    'Reply with a scheduling link when someone wants to talk to a person.',
  'playbook.template.shipstation-tracking-update.name': 'Check a live tracking update',
  'playbook.template.shipstation-tracking-update.summary':
    'Ask for the order number and reply that you are checking its tracking status.',
  'playbook.template.quickbooks-invoice-lookup.name': 'Look up an invoice in QuickBooks',
  'playbook.template.quickbooks-invoice-lookup.summary':
    'Ask for the invoice number and route billing questions to the billing team.',
  'playbook.template.edit-order-before-shipping.name': 'Edit an order before it ships',
  'playbook.template.edit-order-before-shipping.summary':
    'Collect the order number and change request, then route it to support fast.',

  // Page (PlaybookPage.tsx)
  'playbook.page.tabsLabel': 'AI Agent',
  'playbook.page.title': 'AI Agent',
  'playbook.page.description':
    'Persona, the skills it runs, what it answers from, and how it is doing.',
  'playbook.page.loadError': 'Could not load the playbook. Check that the API is reachable.',
  'playbook.actions.browseTemplates': 'Browse templates',
  'playbook.actions.newSkill': 'New skill',
  'playbook.actions.creating': 'Creating…',
  'playbook.tabs.performance': 'Performance',
  'playbook.tabs.profile': 'Profile',
  'playbook.tabs.skills': 'Skills',
  'playbook.tabs.knowledge': 'Knowledge',
  'playbook.tabs.kb': 'Public KB',

  // The AI agent card
  'playbook.agent.skillsCount.one': '{count} skill',
  'playbook.agent.skillsCount.other': '{count} skills',
  'playbook.agent.answering': 'Answering',
  'playbook.agent.paused': 'Paused',
  'playbook.agent.pauseAll': 'Pause all skills',
  'playbook.agent.resume': 'Resume',
  'playbook.agent.pausedNote': 'Paused — no skill runs, whatever its own switch says.',
  'playbook.agent.notReady':
    'Not ready to turn on. Add a knowledge source or a skill with steps before turning the AI on — with neither, it would answer nothing.',

  // Skills tab
  'playbook.skillTabs.all': 'All',
  'playbook.skillTabs.ai': 'AI',
  'playbook.skillTabs.workspace': 'Workspace',
  'playbook.skillTabs.drafts': 'Drafts',
  'playbook.skillsEmpty.all': 'No skills match.',
  'playbook.skillsEmpty.ai': 'No AI skills are on yet. Turn a skill on to have the agent run it.',
  'playbook.skillsEmpty.workspace': 'No workspace automations yet.',
  'playbook.skillsEmpty.drafts': 'No drafts — every skill here is on.',
  'playbook.skills.title': 'Skills',
  'playbook.skills.searchLabel': 'Search skills',
  'playbook.skills.searchPlaceholder': 'Search skills…',
  'playbook.skills.filterType': 'Type',
  'playbook.skills.filterTypeAll': 'All types',
  'playbook.skills.filterTypeAi': 'AI',
  'playbook.skills.filterTypeWorkspace': 'Workspace',
  'playbook.skills.filterStatus': 'Status',
  'playbook.skills.filterStatusAny': 'Any status',
  'playbook.skills.filterOwner': 'Owner',
  'playbook.skills.filterOwnerAll': 'All owners',
  'playbook.skills.filterOwnerUnassigned': 'Unassigned',
  'playbook.skills.filterOwnerUnknown': 'Unknown agent',
  'playbook.skills.filterSort': 'Sort',
  'playbook.skills.sortNameAsc': 'Name A–Z',
  'playbook.skills.sortNameDesc': 'Name Z–A',
  'playbook.skills.sortRecent': 'Recently updated',
  'playbook.skills.sortRuns': 'Most used',
  'playbook.skills.clear': 'Clear',
  'playbook.skills.loading': 'Loading…',
  'playbook.skills.emptyTitle': 'No skills yet',
  'playbook.skills.emptyDescription': 'A skill decides what the AI does with an incoming message.',
  'playbook.skills.nothingHereTitle': 'Nothing here',
  'playbook.skills.noMatchTitle': 'No skills match',
  'playbook.skills.noMatchDescription':
    'Try a different search, or clear the filters to see them all.',
  'playbook.skills.clearFilters': 'Clear filters',
  'playbook.skills.stepsCount.one': '{count} step',
  'playbook.skills.stepsCount.other': '{count} steps',
  'playbook.skills.runsCount.one': '{count} run',
  'playbook.skills.runsCount.other': '{count} runs',
  'playbook.skills.on': 'On',
  'playbook.skills.off': 'Off',
  'playbook.skills.enable': 'Enable',
  'playbook.skills.disable': 'Disable',
  'playbook.skills.needsStep': 'Needs at least one step before it can be turned on.',
  'playbook.skills.editorTitle': 'Editor',
  'playbook.skills.noSelectionTitle': 'No skill selected',
  'playbook.skills.noSelectionDescription':
    'Pick a skill to write its instruction and preview what it does.',

  // Knowledge tab (KnowledgePanel, inside PlaybookPage.tsx)
  'playbook.knowledge.title': 'Knowledge',
  'playbook.knowledge.description':
    'What the AI answers from. Indexed on save, so it is answerable immediately.',
  'playbook.knowledge.formTitle': 'Title',
  'playbook.knowledge.formTitlePlaceholder': 'Delivery and returns',
  'playbook.knowledge.formTitleRequiredError': 'Enter a title.',
  'playbook.knowledge.formType': 'Type',
  'playbook.knowledge.typeWebsite': 'Website',
  'playbook.knowledge.typeFile': 'File',
  'playbook.knowledge.typeArticle': 'Article',
  'playbook.knowledge.typeFaq': 'FAQ',
  'playbook.knowledge.formUrl': 'Website URL',
  'playbook.knowledge.formUrlPlaceholder': 'https://example.com/help/delivery',
  'playbook.knowledge.formUrlHelp':
    'Crawled and indexed on save. Private and internal addresses are refused.',
  'playbook.knowledge.formUrlRequiredError': 'Enter a URL to crawl.',
  'playbook.knowledge.formContent': 'Content',
  'playbook.knowledge.formContentPlaceholder': 'Standard delivery takes 3 to 5 working days…',
  'playbook.knowledge.formContentRequiredError': 'Enter the content.',
  'playbook.knowledge.crawling': 'Crawling…',
  'playbook.knowledge.indexing': 'Indexing…',
  'playbook.knowledge.addSource': 'Add source',
  'playbook.knowledge.tabsLabel': 'Knowledge types',
  'playbook.knowledge.tabAll': 'All',
  'playbook.knowledge.tabWebsite': 'Websites',
  'playbook.knowledge.tabFile': 'Files',
  'playbook.knowledge.tabArticle': 'Articles',
  'playbook.knowledge.tabFaq': 'FAQ',
  'playbook.knowledge.loading': 'Loading…',
  'playbook.knowledge.chunkCount.one': '{count} chunk',
  'playbook.knowledge.chunkCount.other': '{count} chunks',
  'playbook.knowledge.emptyTitle': 'Nothing indexed',
  'playbook.knowledge.emptyDescription': 'Without knowledge, a skill can only send fixed replies.',
  'playbook.knowledge.noneInTab': 'No {type} sources yet.',
  'playbook.knowledge.indexed': 'Indexed',
  'playbook.knowledge.empty': 'Empty',
  'playbook.knowledge.deleteLabel': 'Delete {name}',
  'playbook.knowledge.delete': 'Delete',

  // Skill editor (SkillEditor.tsx)
  'playbook.editor.name': 'Name',
  'playbook.editor.instruction': 'Instruction',
  'playbook.editor.instructionPlaceholder':
    'When someone asks about delivery times, ask for their order number.\nTag it as shipping.\nAnswer from the knowledge base.',
  'playbook.editor.compile': 'Compile to steps',
  'playbook.editor.compiling': 'Compiling…',
  'playbook.editor.save': 'Save changes',
  'playbook.editor.saving': 'Saving…',
  'playbook.editor.fixIssues.one': 'Fix {count} step before saving.',
  'playbook.editor.fixIssues.other': 'Fix {count} steps before saving.',
  'playbook.editor.unrecognised.one': '{count} line produced no step',
  'playbook.editor.unrecognised.other': '{count} lines produced no step',
  'playbook.editor.stepsTitle': 'Steps',
  'playbook.editor.dragHint': 'Drag, or use ↑ ↓ to reorder',
  'playbook.editor.noSteps': 'No steps yet. Write an instruction and compile it.',
  'playbook.editor.team': 'Team',
  'playbook.editor.teamPlaceholder': 'Support',
  'playbook.editor.moveUp': 'Move step {index} up',
  'playbook.editor.moveDown': 'Move step {index} down',
  'playbook.editor.previewTitle': 'Preview',
  'playbook.editor.sampleLabel': 'A message a customer might send',
  'playbook.editor.runPreview': 'Run preview',
  'playbook.editor.running': 'Running…',
  'playbook.editor.previewError': 'Could not run the preview.',
  'playbook.editor.replyLabel': 'Reply to the customer',
  'playbook.editor.handsOverTo': 'Hands over to {name}',
  'playbook.editor.tagsLabel': 'Tags: {tags}',
  'playbook.editor.outcomeAnswered': 'Would answer',
  'playbook.editor.outcomeHandedOff': 'Would hand over',
  'playbook.editor.outcomeNothing': 'Would do nothing',

  // Step descriptions — read by SkillEditor.tsx's own describeStepText/
  // issueMessageText, which mirror types.ts's describeStep and step-reorder.ts's
  // issueFor so the same wording is real i18n instead of a hardcoded English
  // sentence — those two files stay untouched (data-shaped, their own tests pin
  // exact English strings) and SkillEditor duplicates the small switch locally.
  'playbook.step.detectIntent': 'Only run when the message is about “{intent}”',
  'playbook.step.requestInfo': 'Ask for {field} — “{prompt}”',
  'playbook.step.requestInfoFallbackField': 'information',
  'playbook.step.tag': 'Tag the conversation “{tag}”',
  'playbook.step.summarize': 'Write a summary for the agent who picks it up',
  'playbook.step.sendKnowledge': 'Answer from the knowledge base',
  'playbook.step.sendText': 'Reply “{text}”',
  'playbook.step.transfer': 'Hand over to {group}',
  'playbook.step.genericLabel': 'Step',
  'playbook.step.moveAnnouncement': 'Moved “{label}” to position {position} of {total}.',
  'playbook.step.issueTransferTeam': 'Choose a team to hand the conversation over to.',
  'playbook.step.issueDetectIntent': 'Name the intent this step should match.',
  'playbook.step.issueRequestInfoField': 'Name the information to collect.',
  'playbook.step.issueRequestInfoPrompt': 'Write the question to ask for it.',
  'playbook.step.issueTag': 'Name the tag to apply.',
  'playbook.step.issueSendMessage': 'Write the reply to send, or answer from knowledge instead.',

  // Template gallery (TemplateGallery.tsx)
  'playbook.gallery.title': 'Browse templates',
  'playbook.gallery.subtitle': 'Pick a starting point — it opens in the editor, yours to change.',
  'playbook.gallery.close': 'Close',
  'playbook.gallery.categoryTablistLabel': 'Template category',
  'playbook.gallery.all': 'All',
  'playbook.gallery.searchLabel': 'Search templates',
  'playbook.gallery.searchPlaceholder': 'Search templates…',
  'playbook.gallery.noMatchTitle': 'No templates match',
  'playbook.gallery.noMatchDescription':
    'Try a different search, or clear the filters to see them all.',
  'playbook.gallery.clearFilters': 'Clear filters',
  'playbook.gallery.templatesListLabel': 'Templates',
  'playbook.gallery.useTemplate': 'Use template',
  'playbook.category.prebuilt': 'Prebuilt',
  'playbook.category.ai': 'AI',
  'playbook.category.trending': 'Trending',
  'playbook.common.opening': 'Opening…',
  'playbook.common.needsIntegration': 'Needs the {app} app connected.',
  // A card highlight, orthogonal to category (FR-MOD-05.2) — shared by the
  // gallery row and the recommended card.
  'playbook.badge.popular': 'Popular',
  'playbook.badge.essential': 'Essential',

  // Recommended skills (RecommendedSkills.tsx)
  'playbook.recommended.title': 'Recommended skills',
  'playbook.recommended.description': 'Ready-made starting points — try one, then make it yours.',
  'playbook.recommended.listLabel': 'Recommended skills',
  'playbook.recommended.seeMore': 'See more',
  'playbook.recommended.tryThis': 'Try this',

  // Persona form (ProfileForm.tsx)
  'playbook.profile.name': 'Name',
  'playbook.profile.nameRequired': 'Give the assistant a name — the widget shows it to visitors.',
  'playbook.profile.avatarUrl': 'Avatar URL',
  'playbook.profile.avatarPlaceholder': 'https://…',
  'playbook.profile.tone': 'Tone',
  'playbook.profile.tonePlaceholder': 'friendly, professional…',
  'playbook.profile.languages': 'Languages',
  'playbook.profile.answerLength': 'Answer length',
  'playbook.profile.noPreference': 'No preference',
  'playbook.profile.lengthShort': 'Short',
  'playbook.profile.lengthMedium': 'Medium',
  'playbook.profile.lengthLong': 'Long',
  'playbook.profile.save': 'Save profile',
  'playbook.profile.saving': 'Saving…',
  'playbook.profile.previewTitle': 'Preview',
  'playbook.profile.unnamedAssistant': 'Unnamed assistant',
  'playbook.profile.aiAssistant': 'AI assistant',
  'playbook.profile.online': 'Online',
  'playbook.profile.noneYet': 'None yet',
  'playbook.profile.noAgentTitle': 'No AI agent',
  'playbook.profile.noAgentDescription':
    'Once an AI agent exists on this workspace, its persona is edited here.',

  // AI performance (AiPerformance.tsx)
  'playbook.performance.noAccessTitle': 'No access to performance',
  'playbook.performance.noAccessDescription':
    'Viewing AI performance needs the reports permission. Ask an owner to grant it.',
  'playbook.performance.loadError':
    'Could not load AI performance. Check that the API is reachable.',
  'playbook.performance.loading': 'Loading…',
  'playbook.performance.offNotice':
    'The AI is off — these are historical figures. No new chats are being handled while it is paused.',
  'playbook.performance.lowBaseHint': 'Based on few chats — treat as indicative.',
  'playbook.performance.lowBaseFooter':
    'A percentage over a handful of chats swings on a single case. The warned cards will settle as more conversations close.',
  'playbook.performance.kpiResolutionRate': 'Resolution rate',
  'playbook.performance.kpiAiResolutions': 'AI chats resolved',
  'playbook.performance.kpiCsat': 'CSAT',
  'playbook.performance.kpiTransferRate': 'Transferred',

  // Bulk import (BulkImportForm.tsx, BulkImportResults.tsx)
  'playbook.bulk.toggle': 'Bulk import',
  'playbook.bulk.importComplete': 'Import complete',
  'playbook.bulk.done': 'Done',
  'playbook.bulk.description':
    'Import many sources at once from a CSV file — name, type, content, source_url.',
  'playbook.bulk.downloadTemplate': 'Download template',
  'playbook.bulk.fileLabel': 'CSV file',
  'playbook.bulk.preview': 'Preview',
  'playbook.bulk.previewNamed': 'Preview — {name}',
  'playbook.bulk.import': 'Import',
  'playbook.bulk.importing': 'Importing…',
  'playbook.bulk.rejectInvalidType': 'Choose a .csv file exported from a spreadsheet.',
  'playbook.bulk.rejectEmptyFile': 'This file is empty.',
  'playbook.bulk.rejectTooLarge': 'This file is over the {size} MiB limit.',
  'playbook.bulk.processError': 'Could not process that file.',
  'playbook.bulk.results.emptyTitle': 'Nothing to show yet',
  'playbook.bulk.results.emptyDescription':
    'Pick a CSV file with at least one data row to see its rows here.',
  'playbook.bulk.results.summary': '{imported} imported · {failed} skipped',
  'playbook.bulk.results.colRow': 'Row',
  'playbook.bulk.results.colTitle': 'Title',
  'playbook.bulk.results.colType': 'Type',
  'playbook.bulk.results.colStatus': 'Status',
  'playbook.bulk.results.colReason': 'Reason',
  'playbook.bulk.results.imported': 'Imported',
  'playbook.bulk.results.skipped': 'Skipped',

  // Public KB — article list (KbArticleList.tsx)
  'playbook.kb.title': 'Public KB',
  'playbook.kb.description': 'The self-service articles a visitor can read once published.',
  'playbook.kb.newArticle': 'New article',
  'playbook.kb.statusLabel': 'KB article status',
  'playbook.kb.tabAll': 'All',
  'playbook.kb.tabPublished': 'Published',
  'playbook.kb.tabDraft': 'Drafts',
  'playbook.kb.emptyByTabAll': 'No articles match.',
  'playbook.kb.emptyByTabPublished':
    'Nothing published yet — an article goes here once it is published.',
  'playbook.kb.emptyByTabDraft': 'No drafts — every article here is published.',
  'playbook.kb.searchLabel': 'Search articles',
  'playbook.kb.searchPlaceholder': 'Search articles…',
  'playbook.kb.category': 'Category',
  'playbook.kb.allCategories': 'All categories',
  'playbook.kb.uncategorized': 'Uncategorized',
  'playbook.kb.unknownCategory': 'Unknown category',
  'playbook.kb.clear': 'Clear',
  'playbook.kb.emptyTitle': 'No articles yet',
  'playbook.kb.emptyDescription':
    'An article filed here can be published to the public knowledge base.',
  'playbook.kb.nothingHereTitle': 'Nothing here',
  'playbook.kb.noMatchTitle': 'No articles match',
  'playbook.kb.noMatchDescription': 'Try a different search, or clear the filters to see them all.',
  'playbook.kb.clearFilters': 'Clear filters',
  'playbook.kb.statusPublished': 'Published',
  'playbook.kb.statusDraft': 'Draft',
  'playbook.kb.loadError':
    'Could not load the knowledge base articles. Check that the API is reachable.',

  // Article editor (KbArticleEditor.tsx)
  'playbook.kbEditor.newTitle': 'New article',
  'playbook.kbEditor.editTitle': 'Edit article',
  'playbook.kbEditor.disabledBannerTitle': 'KB disabled',
  'playbook.kbEditor.disabledBannerBody':
    'KB is off — the link will not work. Turn it on in KB settings before sharing an article’s address.',
  'playbook.kbEditor.title': 'Title',
  'playbook.kbEditor.slug': 'Slug',
  'playbook.kbEditor.slugRequired': 'Give the article a slug — its permanent address.',
  'playbook.kbEditor.slugPattern': 'Use lower-case letters, numbers and hyphens only.',
  'playbook.kbEditor.slugReserved': '"{slug}" is reserved and cannot be used for an article.',
  'playbook.kbEditor.category': 'Category',
  'playbook.kbEditor.noCategory': 'No category',
  'playbook.kbEditor.newCategoryOption': '+ New category…',
  'playbook.kbEditor.newCategoryLabel': 'New category name',
  'playbook.kbEditor.body': 'Body',
  'playbook.kbEditor.bodyHelp':
    'Supports ## and ### headings, - bullet lists, **bold**, `code`, and [text](url) links. Paragraphs are separated by a blank line. No raw HTML.',
  'playbook.kbEditor.excerpt': 'Excerpt',
  'playbook.kbEditor.seoTitle': 'SEO title',
  'playbook.kbEditor.seoTitleHint': '{count}/60 recommended',
  'playbook.kbEditor.seoDescription': 'SEO description',
  'playbook.kbEditor.seoDescriptionHint': '{count}/155 recommended',
  'playbook.kbEditor.statusPublished': 'Published',
  'playbook.kbEditor.statusDraft': 'Draft',
  'playbook.kbEditor.publish': 'Publish',
  'playbook.kbEditor.unpublish': 'Unpublish',
  'playbook.kbEditor.saving': 'Saving…',
  'playbook.kbEditor.publishError': 'Could not change the publish status.',
  'playbook.kbEditor.copy': 'Copy',
  'playbook.kbEditor.copied': 'Copied',
  'playbook.kbEditor.cancel': 'Cancel',
  'playbook.kbEditor.close': 'Close',
  'playbook.kbEditor.createArticle': 'Create article',
  'playbook.kbEditor.saveChanges': 'Save changes',
  'playbook.kbEditor.titleRequired': 'Give the article a title.',
  'playbook.kbEditor.bodyRequired': 'Write the article body — it cannot be empty.',
  'playbook.kbEditor.reopenError': 'Something went wrong — reopen this article and try again.',
  'playbook.kbEditor.nameCategoryError': 'Name the new category, or pick an existing one.',
  'playbook.kbEditor.discardConfirm': 'Discard your unsaved changes?',
};
