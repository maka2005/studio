/** Цвет знака в логотипе шапки; держать в синхронизации с $color-primary. */
export const BRAND_MARK_COLOR = '#C2410C';

export const SITE = {
  name: 'Renvio',
  url: 'https://servio.kz',
  /**
   * Контакты для страницы «Контакты» и подвала. Пустые поля не показываются.
   * Впишите реальные данные, например: phone: '+7 777 000 00 00', whatsapp: '77770000000', email: 'hello@servio.kz'.
   */
  /**
   * Данные оператора персональных данных для политики конфиденциальности (/privacy). Пустые поля не показываются.
   * Впишите: operator: 'ТОО «…»', bin: '000000000000', address: 'г. …'.
   */
  legal: {
    operator: '',
    bin: '',
    address: '',
  },
  contacts: {
    phone: '',
    whatsapp: '',
    email: '',
  },
};
