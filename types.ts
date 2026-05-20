
export enum KioskStep {
  WELCOME = 'welcome',
  UPLOAD = 'upload',
  PREVIEW = 'preview',
  PAYMENT = 'payment',
  PRINTING = 'printing',
  COMPLETE = 'complete'
}

export interface PrintSettings {
  copies: number;
  colorMode: 'color' | 'bw';
  orientation: 'portrait' | 'landscape';
  sides: 'single' | 'double';
}

export interface PrintJob {
  id: string;
  image: string;
  settings: PrintSettings;
  price: number;
  status: 'pending' | 'paid' | 'printing' | 'finished';
}

export interface PrinterStatus {
  isOnline: boolean;
  paperLevel: number;
  inkLevel: number;
}
