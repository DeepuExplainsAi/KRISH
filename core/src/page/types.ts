export interface PageElement {
  id: number;
  tag: string;
  type?: string;
  role?: string;
  name?: string;
  label?: string;
  text?: string;
  placeholder?: string;
  value?: string;
  href?: string;
  autocomplete?: string;
  title?: string;
  /** Opaque identity of the element at observation time; echoed back on actions so swapped elements are refused. */
  fp?: string;
  /** True when activating it submits a form (effective type, not just the attribute). */
  submits?: boolean;
  disabled?: boolean;
}

export interface PageObservation {
  url: string;
  title: string;
  text: string;
  elements: PageElement[];
  /** data: URL, only used when the user enabled screenshots. */
  screenshotDataUrl?: string;
}
