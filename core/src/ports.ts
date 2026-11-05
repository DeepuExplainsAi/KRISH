/** A file the user picked in the system picker. `token` is opaque; the platform layer resolves it. */
export interface SelectedFile {
  name: string;
  size: number;
  token: string;
}
