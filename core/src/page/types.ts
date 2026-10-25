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
