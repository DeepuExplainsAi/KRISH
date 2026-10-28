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
  /** 1-based number of the <form> this control belongs to; controls with the same number are in the same form. */
  form?: number;
  /** A file input the page hides behind a button or dropzone. It can still be given a file. */
  hidden?: boolean;
}

export interface PageObservation {
  url: string;
  title: string;
  text: string;
  elements: PageElement[];
  /** data: URL, only used when the user enabled screenshots. */
  screenshotDataUrl?: string;
}
