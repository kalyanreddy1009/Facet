/**
 * Copy text to the clipboard, and say whether it actually worked.
 *
 * Three places in the app copied with a bare `navigator.clipboard.writeText(…)`
 * and switched the button to "Copied" on the next line — before the promise
 * settled, and with no catch. Two ways that lies to the user:
 *
 *   - `navigator.clipboard` does not exist outside a secure context. Over the
 *     tunnel this app is https, but anyone reaching it directly on a LAN
 *     (http://192.168.x.x:3000) gets `undefined` and an unhandled TypeError,
 *     with the button cheerfully reading "Copied".
 *   - The write can be rejected by permission policy. Same outcome.
 *
 * The invite link on the admin page is the worst case: it is shown exactly
 * once and cannot be recovered, so a false "Copied" costs a real sign-in link.
 *
 * The fallback is `execCommand("copy")` — deprecated, but it is the only thing
 * that works on an insecure origin, and every browser still implements it.
 */

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through: a rejection here is exactly when the fallback is useful.
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    // Off-screen rather than hidden: `display: none` cannot be selected, and
    // the page must not scroll to a textarea nobody can see.
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
