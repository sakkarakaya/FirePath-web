import { Button } from "./components.js";
import { clear, h } from "./dom.js";

/**
 * Toasts, modals and confirmations.
 *
 * The mobile app uses native Alert dialogs; on the web a blocking `confirm()`
 * looks unfinished and cannot be styled, so destructive actions get a real
 * focus-trapped dialog and successes get a non-blocking toast.
 */

let toastHost = null;

function getToastHost() {
  if (toastHost && document.body.contains(toastHost)) {
    return toastHost;
  }

  toastHost = h("div", {
    class: "toast-host",
    role: "status",
    "aria-live": "polite",
    "aria-atomic": "false"
  });
  document.body.appendChild(toastHost);
  return toastHost;
}

export function toast(message, { level = "success", duration = 4200 } = {}) {
  const host = getToastHost();
  const node = h("div", { class: `toast toast--${level}` }, [
    h("span", { class: "toast__message", text: message }),
    h("button", {
      type: "button",
      class: "toast__close",
      "aria-label": "Dismiss notification",
      text: "×",
      onclick: () => dismiss()
    })
  ]);

  host.appendChild(node);

  const timer = window.setTimeout(dismiss, duration);

  function dismiss() {
    window.clearTimeout(timer);
    node.classList.add("is-leaving");
    // Reduced-motion users get no animation event, so remove on a delay too.
    node.addEventListener("animationend", () => node.remove(), { once: true });
    window.setTimeout(() => node.remove(), 400);
  }

  return dismiss;
}

/**
 * Modal dialog with a focus trap. Returns a `close` function.
 *
 * Focus moves into the dialog on open and back to the trigger on close, and
 * Escape always closes, so the dialog never traps a keyboard user.
 */
export function openModal({ title, description, content, actions, onClose, size } = {}) {
  const trigger = document.activeElement;
  const titleId = `modal-title-${Date.now()}`;

  const dialog = h(
    "div",
    {
      class: `modal ${size ? `modal--${size}` : ""}`.trim(),
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": titleId
    },
    [
      h("header", { class: "modal__header" }, [
        h("div", {}, [
          h("h2", { class: "modal__title", id: titleId, text: title }),
          description && h("p", { class: "modal__description", text: description })
        ]),
        h("button", {
          type: "button",
          class: "modal__close",
          "aria-label": "Close dialog",
          text: "×",
          onclick: () => close()
        })
      ]),
      h("div", { class: "modal__body" }, content),
      actions && h("footer", { class: "modal__footer" }, actions)
    ]
  );

  const overlay = h(
    "div",
    {
      class: "modal-overlay",
      onclick: (event) => {
        if (event.target === overlay) {
          close();
        }
      }
    },
    [dialog]
  );

  document.body.appendChild(overlay);
  document.body.classList.add("has-modal");

  const focusable = () =>
    Array.from(
      dialog.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );

  focusable()[0]?.focus();

  function onKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const items = focusable();
    if (items.length === 0) {
      return;
    }

    const first = items[0];
    const last = items[items.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  document.addEventListener("keydown", onKeydown);

  function close() {
    document.removeEventListener("keydown", onKeydown);
    overlay.remove();
    document.body.classList.remove("has-modal");
    if (trigger instanceof HTMLElement) {
      trigger.focus();
    }
    onClose?.();
  }

  return { close, dialog, setBody: (nodes) => setModalBody(dialog, nodes) };
}

function setModalBody(dialog, nodes) {
  const body = dialog.querySelector(".modal__body");
  if (!body) {
    return;
  }
  clear(body);
  (Array.isArray(nodes) ? nodes : [nodes]).forEach((node) => node && body.appendChild(node));
}

/**
 * Confirmation for destructive actions. Resolves true only when the user picks
 * the confirm button, so callers can `await` before deleting anything.
 */
export function confirmAction({
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = true
} = {}) {
  return new Promise((resolve) => {
    let settled = false;

    const settle = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    const modal = openModal({
      title,
      description,
      size: "sm",
      content: [],
      actions: [
        Button(
          {
            variant: "ghost",
            onclick: () => {
              settle(false);
              modal.close();
            }
          },
          cancelLabel
        ),
        Button(
          {
            variant: destructive ? "danger" : "primary",
            onclick: () => {
              settle(true);
              modal.close();
            }
          },
          confirmLabel
        )
      ],
      onClose: () => settle(false)
    });
  });
}

/**
 * Hands the user a generated file.
 *
 * Object URLs are revoked on the next tick; revoking synchronously can cancel
 * the download before the browser has read the blob.
 */
export function downloadFile(fileName, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = h("a", { href: url, download: fileName, class: "visually-hidden" });

  document.body.appendChild(link);
  link.click();

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    link.remove();
  }, 0);
}
