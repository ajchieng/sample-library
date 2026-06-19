import clsx from "clsx";

export type ToastKind = "info" | "success" | "error";

export type ToastMessage = {
  text: string;
  kind: ToastKind;
};

type Props = {
  toast: ToastMessage | null;
  onDismiss: () => void;
};

export function Toast({ toast, onDismiss }: Props) {
  if (!toast) return null;
  return (
    // A live region that announces itself; click-to-dismiss is a mouse-only
    // convenience (the toast also auto-dismisses on a timer), so keyboard users
    // lose nothing by it not being focusable.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      className={clsx("toast", `toast-${toast.kind}`)}
      role="status"
      onClick={onDismiss}
    >
      {toast.text}
    </div>
  );
}
