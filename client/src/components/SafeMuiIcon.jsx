import { createElement } from 'react';
import { resolveIconComponent } from "../utils/iconInterop";

// Renders an MUI icon from a component REFERENCE (icon={VideocamIcon}),
// surviving the Vite-dev CJS interop case where the reference arrives as a
// module object. A missing/unresolvable icon renders nothing instead of
// crashing the page.
export default function SafeMuiIcon({ icon, ...props }) {
  const Icon = resolveIconComponent(icon);

  if (!Icon) {
    return null;
  }

  // createElement is intentional here: the component type is resolved from a
  // possible CJS module wrapper at runtime, so it cannot be a static JSX tag.
  return createElement(Icon, props);
}
