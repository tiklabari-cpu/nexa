import type { Messages } from '../merge.js';

/** Ekip ve bir temsilcinin kendi bildirim tercihleri. See the English file. */
export const team: Messages = {
  // Modül içi gezinme — TeamTabs.tsx (FR-MOD-04.1)
  'team.tabs.ariaLabel': 'Ekip görünümleri',
  'team.tabs.teammates': 'Ekip arkadaşları',
  'team.tabs.aiAgents': 'AI temsilciler',
  'team.tabs.teams': 'Ekipler',

  // AI temsilciler sayfası — TeamAiAgentsPage.tsx
  'team.aiAgentsPage.description':
    'Bot hesapları, AI’ın performansı ve Copilot’un yararlanabileceği bilgiler.',

  // Ekipler sayfası — TeamsPage.tsx
  'team.teamsPage.description': 'Ekipler oluşturun ve her birinde kimlerin olacağına karar verin.',

  // Team page — TeamPage.tsx
  'team.page.title': 'Ekip',
  'team.page.description': 'Ekip arkadaşları, müsaitlik ve yönlendirmenin iş gönderdiği ekipler.',
  'team.page.loadError':
    'Ekip yüklenemedi. API’nin erişilebilir olduğunu kontrol edip tekrar deneyin.',
  'team.page.kpi.teammates': 'Ekip arkadaşları',
  'team.page.kpi.acceptingChats': 'Sohbet kabul ediyor',
  'team.page.kpi.acceptingChatsHint': 'Kimseye iş atanamaz',
  'team.page.kpi.combinedCapacity': 'Toplam kapasite',
  'team.page.kpi.combinedCapacityHint': 'Kuyruğa girmeden önceki eşzamanlı sohbet sayısı',
  'team.page.kpi.teams': 'Ekipler',
  'team.page.kpi.chatbots': 'Sohbet botları',
  'team.page.kpi.chatbotsHint': 'Ücretsiz — bir bot asla koltuk kullanmaz',
  'team.page.pendingInvitationsTitle': 'Bekleyen davetler',
  'team.page.teammatesTitle': 'Ekip arkadaşları',
  'team.page.empty.noTeammatesTitle': 'Henüz ekip arkadaşı yok',
  'team.page.empty.noTeammatesDescription':
    'Sohbetlerin paylaşılabilmesi için meslektaşlarınızı davet edin.',
  'team.page.empty.noMatchesTitle': 'Eşleşen ekip arkadaşı yok',
  'team.page.empty.noMatchesDescription': 'Farklı bir arama deneyin veya filtreleri temizleyin.',
  'team.page.filters.searchLabel': 'Ekip arkadaşlarında ara',
  'team.page.filters.searchPlaceholder': 'Ad veya e-postaya göre ara',
  'team.page.filters.roleLabel': 'Role göre filtrele',
  'team.page.filters.roleAll': 'Tüm roller',
  'team.page.filters.statusLabel': 'Müsaitliğe göre filtrele',
  'team.page.filters.statusAll': 'Tüm müsaitlik durumları',
  'team.page.filters.twoFactorLabel': "2FA'ya göre filtrele",
  'team.page.filters.twoFactorAll': 'Herhangi bir 2FA',
  'team.page.table.caption': 'Bu lisanstaki temsilciler',
  'team.page.table.name': 'Ad',
  'team.page.table.role': 'Rol',
  'team.page.table.availability': 'Müsaitlik',
  'team.page.table.chatLimit': 'Sohbet limiti',
  'team.page.table.twoFactor': '2FA',
  'team.page.table.skills': 'Yetenekler',
  'team.page.table.manage': 'Yönet',
  'team.page.you': 'siz',
  'team.page.suspendButton': 'Askıya al',
  'team.page.chatbots.title': 'Sohbet botları',
  'team.page.chatbots.description':
    'Bot hesapları kendi başlarına yanıt verir. Ücretsizdirler — bir bot asla koltuk kullanmaz (FR-MOD-04.6).',
  'team.page.empty.noChatbotsTitle': 'Henüz sohbet botu yok',
  'team.page.empty.noChatbotsDescription':
    'Sık sorulan soruları otomatik yanıtlamak için Senaryolar’da bir AI ajanı oluşturun.',
  'team.page.botTable.caption': 'Bu lisanstaki bot hesapları',
  'team.page.botTable.status': 'Durum',
  'team.page.botTable.seatCost': 'Koltuk maliyeti',
  'team.page.botActive': 'Aktif',
  'team.page.free': 'Ücretsiz',
  'team.page.suspended.title': 'Askıya alınanlar',
  'team.page.suspended.description':
    'Askıya alınan temsilciler ekiplerini ve geçmişlerini korur ama yeniden atanana kadar oturum açamaz, sohbet alamaz veya koltuk kullanamaz.',
  'team.page.empty.nobodySuspendedTitle': 'Askıya alınan kimse yok',
  'team.page.empty.nobodySuspendedDescription':
    'Artık iş atanmaması gereken bir ekip arkadaşını yukarıdaki listeden askıya alın.',
  'team.page.suspendedTable.caption': 'Askıya alınan temsilciler',
  'team.page.reinstateButton': 'Yeniden ata',
  'team.page.teams.title': 'Ekipler',
  'team.page.teams.description':
    'Yönlendirme, kapasitesi olan en yüksek öncelik katmanını doldurur, sonra bir sonrakini.',
  'team.page.empty.noTeamsTitle': 'Henüz ekip yok',
  'team.page.empty.noTeamsDescription':
    'Ekipler, bir temsilcinin hangi sohbetleri görebileceğini ve önce kime gideceğini belirler.',
  'team.page.memberCount.one': '{count} üye',
  'team.page.memberCount.other': '{count} üye',
  'team.page.noMembers': 'Üye yok — buraya yönlendirilen sohbetler yedek ekibe düşer.',
  'team.page.formerTeammate': 'Eski ekip arkadaşı',

  // Ekipler — oluştur/düzenle/sil + üyelik. Teams.tsx, TeamEditor.tsx, TeamMembers.tsx
  'team.teams.newButton': 'Yeni ekip',
  'team.teams.card.edit': 'Düzenle',
  'team.teams.card.editAriaLabel': 'Ekibi düzenle — {name}',
  'team.teams.card.manageMembers': 'Üyeleri yönet',
  'team.teams.card.manageMembersAriaLabel': 'Üyeleri yönet — {name}',
  'team.teams.editor.createTitle': 'Yeni ekip',
  'team.teams.editor.editTitle': 'Ekibi düzenle — {name}',
  'team.teams.editor.description':
    'Ekipler, bir temsilcinin hangi sohbetleri görebileceğini ve önce kime gideceğini belirler.',
  'team.teams.editor.nameLabel': 'Ad',
  'team.teams.editor.nameError': 'Bir ekip adı girin.',
  'team.teams.editor.languageLabel': 'Dil',
  'team.teams.editor.languageHint':
    'İki harfli kod, isteğe bağlı bölgeyle — örn. en veya en-GB. İngilizce için boş bırakın.',
  'team.teams.editor.languageError':
    'en veya en-GB gibi, isteğe bağlı bölgeli iki harfli bir dil kodu girin.',
  'team.teams.editor.cancel': 'İptal',
  'team.teams.editor.create': 'Ekip oluştur',
  'team.teams.editor.saveChanges': 'Değişiklikleri kaydet',
  'team.teams.editor.saving': 'Kaydediliyor…',
  'team.teams.editor.discardConfirm': 'Kaydedilmemiş değişiklikleriniz atılsın mı?',
  'team.teams.editor.deleteButton': 'Ekibi sil',
  'team.teams.editor.deleting': 'Siliniyor…',
  'team.teams.members.title': 'Üyeler — {name}',
  'team.teams.members.description':
    'Birden fazla üye müsaitken bir sohbetin önce kime gideceğini öncelik belirler (ADR-08).',
  'team.teams.members.priorityAriaLabel': 'Öncelik — {name}',
  'team.teams.members.removeButton': 'Çıkar',
  'team.teams.members.removeAriaLabel': '{name} adlı kişiyi bu ekipten çıkar',
  'team.teams.members.addLabel': 'Bir ekip arkadaşı ekle',
  'team.teams.members.addAgentAriaLabel': 'Eklenecek ekip arkadaşı',
  'team.teams.members.addPriorityAriaLabel': 'Yeni üye için öncelik',
  'team.teams.members.addButton': 'Ekle',
  'team.teams.members.adding': 'Ekleniyor…',
  'team.teams.members.empty': 'Henüz üye yok.',
  'team.teams.members.noneToAdd': 'Bu lisanstaki her ekip arkadaşı zaten üye.',
  'team.teams.members.close': 'Kapat',

  // Routing status / on-off, shared across TeamPage and NotificationSettings
  'team.status.acceptingChats': 'Sohbet kabul ediyor',
  'team.status.notAccepting': 'Kabul etmiyor',
  'team.status.offline': 'Çevrimdışı',
  'team.status.on': 'Açık',
  'team.status.off': 'Kapalı',

  // Role names — TeamPage's roster, InviteTeammates' role picker and pending list
  'team.role.owner': 'Sahip',
  'team.role.viceowner': 'Sahip yardımcısı',
  'team.role.admin': 'Yönetici',
  'team.role.agent': 'Temsilci',

  // Team assignment priority — TeamPage.tsx's group member list
  'team.priority.primary': 'Öncelikli',
  'team.priority.first': 'İlk',
  'team.priority.normal': 'Normal',
  'team.priority.last': 'Son',

  // Work schedule — WorkSchedule.tsx
  'team.workSchedule.title': 'Çalışma programı',
  'team.workSchedule.description':
    'Her ekip arkadaşının standart haftalık saatleri — personel tahmininin kapsama boşluklarını öngörmek için okuduğu veri.',
  'team.workSchedule.empty.title': 'Henüz programlanacak kimse yok',
  'team.workSchedule.empty.description':
    'Çalışma programı kurmadan önce ekip arkadaşlarınızı davet edin.',
  'team.workSchedule.teammateLabel': 'Ekip arkadaşı',
  'team.workSchedule.optionYou': '{name} (siz)',
  'team.workSchedule.yourWeeklyHours': 'Haftalık saatleriniz',
  'team.workSchedule.editButton': 'Programı düzenle',
  'team.workSchedule.modalTitle': 'Çalışma programı — {name}',
  'team.workSchedule.modalDescription':
    'Bu ekip arkadaşının kendi saat diliminde standart haftalık saatleri. Kapalı bir gün, ayarlı saatlerini korur, yalnızca kapatılmış olur.',
  'team.workSchedule.loading': 'Yükleniyor…',
  'team.workSchedule.loadError': 'Bu program yüklenemedi.',
  'team.workSchedule.timezoneLabel': 'Saat dilimi',
  'team.workSchedule.startTimeAriaLabel': '{day} başlangıç saati',
  'team.workSchedule.endTimeAriaLabel': '{day} bitiş saati',
  'team.workSchedule.error.badTime': '09:00 gibi 24 saatlik bir saat girin.',
  'team.workSchedule.error.endBeforeStart': 'Bitiş, başlangıçtan sonra olmalı.',
  'team.workSchedule.discardConfirm': 'Kaydedilmemiş program değişiklikleriniz atılsın mı?',
  'team.workSchedule.cancel': 'İptal',
  'team.workSchedule.saveButton': 'Programı kaydet',
  'team.workSchedule.saving': 'Kaydediliyor…',

  // Invite teammates — InviteTeammates.tsx
  'team.invite.title': 'Ekip arkadaşı davet et',
  'team.invite.description': 'Satır başına bir adres, ya da virgülle ayırarak.',
  'team.invite.emailsLabel': 'E-posta adresleri',
  'team.invite.roleLabel': 'Rol',
  'team.invite.linkSentNotice':
    'Davetler gönderildi. Bu bağlantı yalnızca bir kez çalışır ve yedi gün geçerlidir — bir daha gösterilmez.',
  'team.invite.copyLink': 'Davet bağlantısını kopyala',
  'team.invite.discardConfirm': 'Yazdığınız adresler atılsın mı?',
  'team.invite.cancel': 'İptal',
  'team.invite.done': 'Bitti',
  'team.invite.sending': 'Gönderiliyor…',
  'team.invite.submit': 'Davet et',
  'team.invite.submitCount': '{count} kişiyi davet et',
  'team.invite.error.invalidEmails': 'Geçersiz adres: {emails}',
  'team.invite.error.aboveRole': 'Kendi rolünüzün üstünde birini davet edemezsiniz.',
  'team.invite.error.generic': 'Bu davetler gönderilemedi.',
  'team.invite.pending.caption': 'Henüz kabul edilmemiş davetler',
  'team.invite.pending.email': 'E-posta',
  'team.invite.pending.role': 'Rol',
  'team.invite.pending.invitedBy': 'Davet eden',
  'team.invite.pending.revoke': 'İptal et',

  // Temsilci profil paneli — AgentProfile.tsx (FR-MOD-04.3.4)
  'team.profile.openAriaLabel': '{name} — profil',
  'team.profile.title': 'Profil — {name}',
  'team.profile.description': 'Bu takım arkadaşı kim ve yönlendirme ona ne kadar kapasite veriyor.',
  'team.profile.role': 'Rol',
  'team.profile.email': 'E-posta',
  'team.profile.lastSeen': 'Son görülme',
  'team.profile.neverSeen': 'Hiç',
  'team.profile.chattingTeams': 'Sohbet takımları',
  'team.profile.noTeams': 'Henüz hiçbir takımda değil.',
  'team.profile.chatLimit': 'Eş zamanlı sohbet limiti',
  'team.profile.chatLimitHint': 'Bu kadar sohbet açıkken yönlendirme yeni sohbetleri sıraya alır.',
  'team.profile.chatLimitError': '1 ile 50 arasında bir tam sayı girin.',
  'team.profile.saveError': 'Bu sohbet limiti kaydedilemedi.',
  'team.profile.save': 'Limiti kaydet',
  'team.profile.saving': 'Kaydediliyor…',
  'team.profile.manageProfile': 'Profili yönet',
  'team.profile.close': 'Kapat',

  // Per-agent skills — AgentSkills.tsx
  'team.skills.manageAriaLabel': '{name} için yetenekleri yönet',
  'team.skills.noSkills': 'Yetenek yok',
  'team.skills.dialogTitle': 'Yetenekler — {name}',
  'team.skills.dialogDescription':
    'Yeteneğe dayalı yönlendirme bu temsilciye yalnızca sahip olduğu her yeteneği gerektiren sohbetleri atar.',
  'team.skills.loading': 'Yükleniyor…',
  'team.skills.loadError': 'Yetenek kataloğu yüklenemedi.',
  'team.skills.empty.title': 'Katalogda henüz yetenek yok',
  'team.skills.empty.description':
    'Buradan bir temsilciye atamadan önce Ayarlar → Yetenekler’de bir yetenek ekleyin.',
  'team.skills.saveError': 'Bu temsilcinin yetenekleri kaydedilemedi.',
  'team.skills.cancel': 'İptal',
  'team.skills.close': 'Kapat',
  'team.skills.saveButton': 'Kaydet',
  'team.skills.saving': 'Kaydediliyor…',

  // Change a teammate's role — RoleMenu.tsx (NFR-S12)
  'team.roleChange.openButton': 'Rolü değiştir',
  'team.roleChange.openAriaLabel': '{name} için rolü değiştir',
  'team.roleChange.dialogTitle': 'Rolü değiştir — {name}',
  'team.roleChange.dialogDescription':
    'Rol, bu ekip arkadaşının neler yapabileceğini belirler. Değişiklik bir sonraki isteğinde geçerli olur ve denetim kaydına yazılır.',
  'team.roleChange.roleLabel': 'Rol',
  'team.roleChange.ceilingHint':
    'Yalnızca kendi rolünüz ya da altındaki bir rolü atayabilirsiniz. Çalışma alanının devri ayrı bir işlem olduğu için Sahip burada hiç sunulmaz.',
  'team.roleChange.cancel': 'İptal',
  'team.roleChange.saveButton': 'Kaydet',
  'team.roleChange.saving': 'Kaydediliyor…',
  'team.roleChange.error.refused':
    'Sunucu bu değişikliği reddetti. Bir rol yalnızca kendi rütbeniz ya da altında atanabilir; kendinize ya da sahibe atanamaz.',

  // Notification preferences — NotificationSettings.tsx (FR-MOD-13.8)
  'team.notifications.title': 'Bildirimler',
  'team.notifications.description':
    'Yeni mesajlar için nasıl uyarılacağınız. Bunlar bu çalışma alanındaki hesabınızı izler; bu tarayıcının masaüstü bildirimi gösterip gösteremeyeceği ayrı bir ayardır.',
  'team.notifications.enable.label': 'Bildirimleri etkinleştir',
  'team.notifications.saveFailed': 'Kaydedilemedi — lütfen tekrar deneyin.',
  'team.notifications.enable.hint':
    'Bunu kapatmak sesi, masaüstünü, push’u ve sekme uyarılarını birlikte susturur. E-posta yine de ulaşır.',
  'team.notifications.sound.label': 'Bir ses çal',
  'team.notifications.sound.hint': 'Bir ziyaretçi yazdığında kısa bir ton.',
  'team.notifications.desktop.label': 'Masaüstü bildirimleri',
  'team.notifications.desktop.granted': 'Bu sekme arka plandayken bile gösterilir.',
  'team.notifications.desktop.denied':
    'Tarayıcınızda engellendi — kullanmak için bu site için bildirimlere izin verin.',
  'team.notifications.desktop.unsupported': 'Bu tarayıcı masaüstü bildirimlerini desteklemiyor.',
  'team.notifications.desktop.default': 'Bunları göstermek için tarayıcınızdan izin isteyin.',
  'team.notifications.desktop.enableButton': 'Masaüstü bildirimlerini etkinleştir',
  'team.notifications.push.label': 'Mobil push bildirimleri',
  'team.notifications.push.hint':
    'Oturum açtığınız herhangi bir telefondaki Nexa uygulamasına gönderilir. Hangi cihazlar olduğu uygulamanın kendisinden yönetilir.',
  'team.notifications.email.label': 'E-posta bildirimleri',
  'team.notifications.email.hint':
    'Size atanmış bir sohbete bir ziyaretçi yazdığında, Nexa kapalı olsa bile e-posta gönderilir. Yukarıdaki anahtardan etkilenmez — e-posta uzakta olduğunuzda yedek kanaldır.',
  // AI agent performance on the Team screen — TeamAiPerformance.tsx (FR-MOD-04.2)
  'team.ai.title': 'AI temsilci performansı',
  'team.ai.description':
    'AI’ın sohbetleri nasıl yürüttüğü ve bu çalışma alanındaki temsilciler. Yeteneklerini, bilgisini ve profilini yönetmek için birini açın.',
  'team.ai.loadError': 'AI temsilciler yüklenemedi. API’ye erişilebildiğini kontrol edin.',
  'team.ai.empty.title': 'Henüz AI temsilci yok',
  'team.ai.empty.description':
    'Sık sorulan soruları otomatik yanıtlaması için Playbook’ta bir AI temsilci oluşturun.',
  'team.ai.table.caption': 'Bu lisanstaki AI temsilciler',
  'team.ai.openPerformance': 'Performansı aç',
  'team.ai.byAgent.title': 'Ajan bazlı AI performansı',
  'team.ai.byAgent.description':
    'Her takım üyesinin AI’a ne kadar dayandığı — yukarıdaki kartlarla aynı aralık için sohbetler, çözüm dağılımı ve insana hiç ihtiyaç duymayanların sayısı.',

  // Copilot knowledge — CopilotKnowledge.tsx (FR-MOD-12.2)
  'team.copilot.title': 'Copilot bilgisi',
  'team.copilot.description':
    'Copilot bir temsilciye yardım ederken neleri aktarabileceği. Müşteriye bakan AI temsilcinin bilgisinden ayrı tutulur ve hiçbir zaman bir müşteriye gösterilmez (FR-MOD-12.2).',
  'team.copilot.shortDescription':
    'Copilot bir temsilciye yardım ederken neleri aktarabileceği (FR-MOD-12.2).',
  'team.copilot.noAccess.title': 'Copilot bilgisine erişim yok',
  'team.copilot.noAccess.description':
    'Copilot bilgi tabanını yönetmek AI temsilci iznini gerektirir. Bir sahipten vermesini isteyin.',
  'team.copilot.loadError':
    'Copilot bilgi tabanı yüklenemedi. API’ye erişilebildiğini kontrol edin.',
  'team.copilot.empty.title': 'Henüz Copilot kaynağı yok',
  'team.copilot.empty.canEdit':
    'Copilot yardım ederken yararlanabilsin diye aşağıya bir makale veya SSS ekleyin.',
  'team.copilot.empty.readOnly': 'Bir yönetici henüz Copilot bilgisi eklemedi.',
  'team.copilot.table.caption': 'Copilot bilgi kaynakları',
  'team.copilot.table.type': 'Tür',
  'team.copilot.table.chunks': 'Parça',
  'team.copilot.table.updated': 'Güncellendi',
  'team.copilot.type.article': 'Makale',
  'team.copilot.type.faq': 'SSS',
  'team.copilot.type.file': 'Dosya',
  'team.copilot.deleteButton': 'Sil',
  'team.copilot.add.title': 'Kaynak ekle',
  'team.copilot.add.error': 'Bu kaynak eklenemedi. Adı ve içeriği kontrol edip tekrar deneyin.',
  'team.copilot.add.nameRequiredError': 'Bir ad girin.',
  'team.copilot.add.contentLabel': 'İçerik',
  'team.copilot.add.contentRequiredError': 'İçeriği girin.',
  'team.copilot.add.submit': 'Kaynak ekle',
  'team.copilot.add.submitting': 'Ekleniyor…',
};
