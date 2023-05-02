export interface IWebApp {
  initData: string;
  initDataUnsafe: InitDataUnsafe;
  version: string;
  platform: string;
  colorScheme: string;
  themeParams: ThemeParams;
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  isClosingConfirmationEnabled: boolean;
  headerColor: string;
  backgroundColor: string;
  BackButton: {
    isVisible: boolean;
  };
  MainButton: {
    text: string;
    color: string;
    textColor: string;
    isVisible: boolean;
    isProgressVisible: boolean;
    isActive: boolean;
  };
  HapticFeedback: any;
}

export interface MainButton {
  text: string;
  color: string;
  textColor: string;
  isVisible: boolean;
  isProgressVisible: boolean;
  isActive: boolean;
}

export interface InitDataUnsafe {
  query_id: string;
  user: User;
  auth_date: string;
  hash: string;
}

export interface User {
  id: number;
  first_name: string;
  last_name: string;
  username: string;
  language_code: string;
  is_premium: boolean;
}

export interface ThemeParams {
  secondary_bg_color: string;
  button_color: string;
  hint_color: string;
  text_color: string;
  bg_color: string;
  button_text_color: string;
  link_color: string;
}

declare global {
  interface Window {
    Telegram: {
      WebApp: Partial<IWebApp>;
    };
  }
}

window.Telegram = window.Telegram || {};
