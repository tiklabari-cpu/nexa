/**
 * The Turkish text of the skill template catalogue (D18, tm 259.18).
 *
 * `templates.ts` is English seed data. The gallery already showed each card's
 * name and summary in the panel's language, but picking a card minted a skill
 * whose name, instruction, questions and replies were the English ones — the
 * workspace's visitors would have been answered in a language its admin chose
 * not to work in. `templateToDraft(template, 'tr')` reads this module instead.
 *
 * Only words change. What the engine and the rest of the product match on is
 * left exactly as the catalogue has it, and a test pins that:
 *   - step order and `type`, `intent`, `field`, `source`;
 *   - `tag` names (a workspace's tag library and its reports key on them);
 *   - `group` (a team *name* the admin has to have created — translating it
 *     would point at a team that does not exist).
 * Text is supplied per step by position; `{}` means "this step has none".
 *
 * `detect_intent` phrases are what a visitor's message is matched against, so
 * they are written the way a Turkish visitor types — both with and without
 * diacritics where people commonly drop them.
 */

/** The words of one step. Which fields are allowed depends on the step's type. */
export interface StepText {
  /** `detect_intent`: what a visitor might write. */
  phrases?: string[];
  /** `request_info`: the question put to the visitor. */
  prompt?: string;
  /** `send_message` with `source: 'text'`: the fixed reply. */
  text?: string;
}

export interface TemplateText {
  instruction: string;
  /** One entry per step of the English template, in order. */
  steps: StepText[];
}

export const TEMPLATE_TEXT_TR: Readonly<Record<string, TemplateText>> = {
  'order-status': {
    instruction:
      'Biri siparişinin nerede olduğunu sorduğunda sipariş numarasını iste.\nEtiketi shipping olarak ekle.\nBilgi tabanından yanıtla.',
    steps: [
      {
        phrases: [
          'siparişim nerede',
          'siparisim nerede',
          'sipariş durumu',
          'siparis durumu',
          'teslimat',
          'kargo takibi',
        ],
      },
      { prompt: 'Sipariş numaranız nedir?' },
      {},
      {},
    ],
  },
  'returns-policy': {
    instruction:
      'Biri iade ya da geri ödeme politikasını sorduğunda etiketi returns olarak ekle.\nBilgi tabanından yanıtla.',
    steps: [
      {
        phrases: [
          'iade',
          'iade politikası',
          'iade politikasi',
          'geri göndermek',
          'değişim',
          'degisim',
        ],
      },
      {},
      {},
    ],
  },
  'business-hours': {
    instruction:
      'Biri çalışma saatlerini sorduğunda şu yanıtı ver: "Pazartesi’den Cuma’ya, 09.00–18.00 (CET) arasında yanıt veriyoruz. İstediğiniz zaman mesaj bırakabilirsiniz, size dönüş yapacağız."',
    steps: [
      {
        phrases: [
          'açık mısınız',
          'acik misiniz',
          'çalışma saatleri',
          'calisma saatleri',
          'saat kaçta',
          'kapalı',
        ],
      },
      {
        text: 'Pazartesi’den Cuma’ya, 09.00–18.00 (CET) arasında yanıt veriyoruz. İstediğiniz zaman mesaj bırakabilirsiniz, size dönüş yapacağız.',
      },
    ],
  },
  'shipping-cost': {
    instruction:
      'Biri kargo ücretini sorduğunda etiketi shipping olarak ekle.\nBilgi tabanından yanıtla.',
    steps: [
      {
        phrases: [
          'kargo ücreti',
          'kargo ucreti',
          'teslimat ücreti',
          'kargo ne kadar',
          'kargo fiyatı',
        ],
      },
      {},
      {},
    ],
  },
  'order-cancellation': {
    instruction:
      'Biri siparişini iptal etmek istediğinde sipariş numarasını iste.\nEtiketi cancellation olarak ekle.\nDestek ekibine devret.',
    steps: [
      {
        phrases: [
          'siparişimi iptal et',
          'siparisimi iptal et',
          'siparişi iptal',
          'artık istemiyorum',
          'artik istemiyorum',
        ],
      },
      { prompt: 'Sipariş numaranız nedir?' },
      {},
      {},
    ],
  },
  'payment-methods': {
    instruction:
      'Biri hangi ödeme yöntemlerini kabul ettiğinizi sorduğunda bilgi tabanından yanıtla.',
    steps: [
      {
        phrases: [
          'ödeme yöntemleri',
          'odeme yontemleri',
          'nasıl ödeme yapabilirim',
          'nasil odeme yapabilirim',
          'paypal kabul',
          'kredi kartı',
        ],
      },
      {},
    ],
  },
  'change-shipping-address': {
    instruction:
      'Biri teslimat adresini değiştirmek istediğinde sipariş numarasını iste.\nEtiketi address-change olarak ekle.\nDestek ekibine devret.',
    steps: [
      {
        phrases: [
          'adresimi değiştir',
          'adresimi degistir',
          'yanlış adres',
          'yanlis adres',
          'teslimat adresini güncelle',
        ],
      },
      { prompt: 'Sipariş numaranız nedir?' },
      {},
      {},
    ],
  },
  'warranty-coverage': {
    instruction: 'Biri garanti kapsamını sorduğunda bilgi tabanından yanıtla.',
    steps: [
      {
        phrases: [
          'garanti',
          'garanti kapsamında mı',
          'garanti kapsaminda mi',
          'bozuk ürün',
          'bozuk urun',
        ],
      },
      {},
    ],
  },
  'contact-support': {
    instruction:
      'Biri destekle nasıl iletişime geçeceğini sorduğunda şu yanıtı ver: "Bize doğrudan bu sohbetten ulaşabilir ya da support@acme.com adresine e-posta gönderebilirsiniz — genellikle birkaç saat içinde yanıt veriyoruz."',
    steps: [
      {
        phrases: [
          'size ulaşmak',
          'size ulasmak',
          'telefon numarası',
          'telefon numarasi',
          'e-posta adresi',
          'biriyle konuşmak',
          'biriyle konusmak',
        ],
      },
      {
        text: 'Bize doğrudan bu sohbetten ulaşabilir ya da support@acme.com adresine e-posta gönderebilirsiniz — genellikle birkaç saat içinde yanıt veriyoruz.',
      },
    ],
  },
  'discount-code-issue': {
    instruction:
      'Biri indirim kodunun çalışmadığını söylediğinde kodu iste.\nEtiketi discount olarak ekle.\nDestek ekibine devret.',
    steps: [
      {
        phrases: ['indirim kodu', 'promosyon kodu', 'kupon çalışmıyor', 'kupon calismiyor'],
      },
      { prompt: 'Hangi indirim kodunu kullanmaya çalışıyorsunuz?' },
      {},
      {},
    ],
  },
  'delete-my-account': {
    instruction:
      'Biri hesabını silmek istediğinde etiketi privacy olarak ekle.\nDestek ekibine devret.',
    steps: [
      {
        phrases: [
          'hesabımı sil',
          'hesabimi sil',
          'hesabımı kapat',
          'hesabimi kapat',
          'verilerimi sil',
        ],
      },
      {},
      {},
    ],
  },
  'greet-and-route': {
    instruction:
      'Biri merhaba dediğinde şu yanıtı ver: "Merhaba! Ben Acme asistanıyım — bugün size nasıl yardımcı olabilirim?"\nBilgi tabanından yanıtla.',
    steps: [
      { phrases: ['merhaba', 'selam', 'günaydın', 'gunaydin', 'iyi günler', 'iyi gunler'] },
      { text: 'Merhaba! Ben Acme asistanıyım — bugün size nasıl yardımcı olabilirim?' },
      {},
    ],
  },
  'collect-then-handover': {
    instruction:
      'Müşterinin e-posta adresini iste.\nSohbeti devralacak temsilci için bir özet yaz.\nDestek ekibine devret.',
    steps: [{ prompt: 'Size ulaşabileceğimiz en uygun e-posta adresi nedir?' }, {}, {}],
  },
  'troubleshoot-then-escalate': {
    instruction:
      'Biri üründe bir sorun bildirdiğinde bilgi tabanından yanıtla.\nSohbeti devralacak temsilci için bir özet yaz.\nDestek ekibine devret.',
    steps: [
      {
        phrases: [
          'çalışmıyor',
          'calismiyor',
          'bozuk',
          'hata',
          'çalışmayı bıraktı',
          'calismayi birakti',
        ],
      },
      {},
      {},
      {},
    ],
  },
  'angry-customer-deescalate': {
    instruction:
      'Biri sinirli ya da öfkeli göründüğünde şu yanıtı ver: "Yaşadığınız sıkıntı için üzgünüm — konuyu hemen size yardımcı olabilecek birine aktarıyorum."\nSohbeti devralacak temsilci için bir özet yaz.\nDestek ekibine devret.',
    steps: [
      {
        phrases: ['sinirliyim', 'çok kızgınım', 'cok kizginim', 'kabul edilemez', 'berbat hizmet'],
      },
      {
        text: 'Yaşadığınız sıkıntı için üzgünüm — konuyu hemen size yardımcı olabilecek birine aktarıyorum.',
      },
      {},
      {},
    ],
  },
  'product-recommendation': {
    instruction:
      'Biri ürün önerisi istediğinde ne yapmaya çalıştığını sor.\nBilgi tabanından yanıtla.',
    steps: [
      {
        phrases: ['ne almalıyım', 'ne almaliyim', 'öner', 'oner', 'hangisi en iyisi'],
      },
      { prompt: 'Onu ne için kullanmayı düşünüyorsunuz?' },
      {},
    ],
  },
  'onboarding-walkthrough': {
    instruction:
      'Biri yeni olduğunu ya da yeni kaydolduğunu söylediğinde şu yanıtı ver: "Aramıza hoş geldiniz! Başlamanıza yardımcı olmaktan memnuniyet duyarım."\nBilgi tabanından yanıtla.',
    steps: [
      {
        phrases: [
          'yeni kaydoldum',
          'yeniyim',
          'nasıl başlarım',
          'nasil baslarim',
          'başlangıç',
          'baslangic',
        ],
      },
      { text: 'Aramıza hoş geldiniz! Başlamanıza yardımcı olmaktan memnuniyet duyarım.' },
      {},
    ],
  },
  'billing-question-lookup': {
    instruction:
      'Biri bir ücret ya da faturayı sorduğunda etiketi billing olarak ekle.\nBilgi tabanından yanıtla.',
    steps: [
      {
        phrases: [
          'ücret',
          'ucret',
          'fatura',
          'fatura sorusu',
          'iki kez ödeme çekildi',
          'iki kez odeme cekildi',
        ],
      },
      {},
      {},
    ],
  },
  'cancel-subscription-handover': {
    instruction:
      'Biri aboneliğini iptal etmek istediğinde neden ayrıldığını sor.\nSohbeti devralacak temsilci için bir özet yaz.\nFaturalama ekibine devret.',
    steps: [
      {
        phrases: [
          'aboneliğimi iptal et',
          'aboneligimi iptal et',
          'planı iptal et',
          'plani iptal et',
          'ödemeyi durdurun',
          'odemeyi durdurun',
        ],
      },
      { prompt: 'İptal etmek istemenizin nedenini paylaşır mısınız?' },
      {},
      {},
    ],
  },
  'vip-customer-priority': {
    instruction:
      'Biri uzun süredir ya da premium müşteri olduğunu belirttiğinde şu yanıtı ver: "Bizimle olduğunuz için teşekkürler — sizi hemen kıdemli bir temsilciye aktarıyorum."\nDestek ekibine devret.',
    steps: [
      {
        phrases: [
          'premium müşteri',
          'premium musteri',
          'yıllardır müşterinizim',
          'yillardir musterinizim',
          'sadık müşteri',
          'sadik musteri',
        ],
      },
      {
        text: 'Bizimle olduğunuz için teşekkürler — sizi hemen kıdemli bir temsilciye aktarıyorum.',
      },
      {},
    ],
  },
  // The greeting this template reacts to — and the reply it sends — are Spanish
  // by design, so the steps keep their words; only the instruction is explained
  // in Turkish.
  'multilingual-greeting': {
    instruction:
      'Biri İspanyolca merhaba dediğinde şu yanıtı ver: "¡Hola! ¿Cómo puedo ayudarte hoy?"\nBilgi tabanından yanıtla.',
    steps: [{}, {}, {}],
  },
  'post-purchase-checkin': {
    instruction:
      'Biri yakın zamanda bir alışveriş yaptığını söylediğinde ürünün nasıl gittiğini sor.\nBilgi tabanından yanıtla.',
    steps: [
      {
        phrases: [
          'yeni aldım',
          'geçenlerde satın aldım',
          'gecenlerde satin aldim',
          'siparişim geldi',
          'siparisim geldi',
        ],
      },
      { prompt: 'Şimdiye kadar nasıl gitti, memnun kaldınız mı?' },
      {},
    ],
  },
  'shopify-order-lookup': {
    instruction:
      'Biri bir siparişi sorduğunda sipariş numarasını iste.\nŞimdi kontrol ettiğini yanıtla.',
    steps: [
      {
        phrases: [
          'siparişim nerede',
          'siparisim nerede',
          'sipariş durumu',
          'siparis durumu',
          'siparişimi takip et',
          'siparisimi takip et',
        ],
      },
      { prompt: 'Sipariş numaranız nedir?' },
      { text: 'Teşekkürler — bu siparişi sizin için hemen kontrol ediyorum.' },
    ],
  },
  'stripe-refund': {
    instruction: 'Biri geri ödeme istediğinde sipariş numarasını iste.\nFaturalama ekibine devret.',
    steps: [
      {
        phrases: [
          'geri ödeme',
          'geri odeme',
          'param iade',
          'siparişimi iptal et',
          'siparisimi iptal et',
        ],
      },
      { prompt: 'Sipariş numaranız nedir?' },
      {},
    ],
  },
  'csat-followup': {
    instruction:
      'Kayıt için bir özet yaz.\nŞu yanıtı ver: "Yardımcı olabildiğime sevindim! Bu görüşmeyi nasıl değerlendirirsiniz?"',
    steps: [{}, { text: 'Yardımcı olabildiğime sevindim! Bu görüşmeyi nasıl değerlendirirsiniz?' }],
  },
  'paypal-refund': {
    instruction:
      'Biri PayPal ile ödediği bir tutarın iadesini istediğinde sipariş numarasını iste.\nFaturalama ekibine devret.',
    steps: [
      {
        phrases: ['paypal iadesi', 'paypal ödememi iade et', 'paypal odememi iade et'],
      },
      { prompt: 'Sipariş numaranız nedir?' },
      {},
    ],
  },
  'salesforce-case-sync': {
    instruction:
      'Biri kayıt altına alınması gereken bir sorun bildirdiğinde sipariş numarasını iste.\nEtiketi escalation olarak ekle.\nDestek ekibine devret.',
    steps: [
      {
        phrases: [
          'kayıt aç',
          'kayit ac',
          'şikayet etmek istiyorum',
          'sikayet etmek istiyorum',
          'kayda geçirin',
          'kayda gecirin',
        ],
      },
      { prompt: 'Sipariş numaranız nedir?' },
      {},
      {},
    ],
  },
  'klaviyo-abandoned-cart': {
    instruction:
      'Biri sepetinde ürün bıraktığını söylediğinde şu yanıtı ver: "Sepetinizde bir şey bıraktığınızı görüyorum — siparişinizi tamamlamanıza yardımcı olayım mı?"',
    steps: [
      {
        phrases: [
          'sepetimde kaldı',
          'sepetimde kaldi',
          'kayıtlı sepet',
          'kayitli sepet',
          'sepette duruyor',
        ],
      },
      {
        text: 'Sepetinizde bir şey bıraktığınızı görüyorum — siparişinizi tamamlamanıza yardımcı olayım mı?',
      },
    ],
  },
  'recharge-subscription-pause': {
    instruction:
      'Biri aboneliğini duraklatmak istediğinde abonelik numarasını iste.\nFaturalama ekibine devret.',
    steps: [
      {
        phrases: [
          'aboneliğimi duraklat',
          'aboneligimi duraklat',
          'bu ayı atla',
          'bu ayi atla',
          'planımı duraklat',
          'planimi duraklat',
        ],
      },
      { prompt: 'Abonelik numaranız nedir?' },
      {},
    ],
  },
  'calendly-book-a-call': {
    instruction:
      'Biri görüşme planlamak istediğinde şu yanıtı ver: "Tabii — size uygun bir zamanı seçebileceğiniz bağlantı burada: [randevu bağlantısı]."',
    steps: [
      {
        phrases: [
          'görüşme ayarla',
          'gorusme ayarla',
          'demo planla',
          'biriyle konuşmak istiyorum',
          'biriyle konusmak istiyorum',
        ],
      },
      {
        text: 'Tabii — size uygun bir zamanı seçebileceğiniz bağlantı burada: [randevu bağlantısı].',
      },
    ],
  },
  'shipstation-tracking-update': {
    instruction:
      'Biri takip bilgisi istediğinde sipariş numarasını iste.\nŞimdi kontrol ettiğini yanıtla.',
    steps: [
      {
        phrases: [
          'takip numarası',
          'takip numarasi',
          'paketim nerede',
          'gönderimi takip et',
          'gonderimi takip et',
        ],
      },
      { prompt: 'Sipariş numaranız nedir?' },
      { text: 'Teşekkürler — takip durumunu sizin için hemen kontrol ediyorum.' },
    ],
  },
  'quickbooks-invoice-lookup': {
    instruction: 'Biri bir faturayı sorduğunda fatura numarasını iste.\nFaturalama ekibine devret.',
    steps: [
      {
        phrases: [
          'fatura numarası',
          'fatura numarasi',
          'eksik fatura',
          'faturama ihtiyacım var',
          'faturama ihtiyacim var',
        ],
      },
      { prompt: 'Fatura numaranız nedir?' },
      {},
    ],
  },
  'edit-order-before-shipping': {
    instruction:
      'Biri siparişini kargoya verilmeden önce değiştirmek istediğinde sipariş numarasını iste.\nEtiketi order-edit olarak ekle.\nDestek ekibine devret.',
    steps: [
      {
        phrases: [
          'siparişimi değiştir',
          'siparisimi degistir',
          'siparişime ürün ekle',
          'siparisime urun ekle',
          'kargoya verilmeden değiştir',
          'kargoya verilmeden degistir',
        ],
      },
      { prompt: 'Sipariş numaranız nedir?' },
      {},
      {},
    ],
  },
};
