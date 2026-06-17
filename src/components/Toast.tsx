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
    <div
      className={clsx("toast", `toast-${toast.kind}`)}
      role="status"
      onClick={onDismiss}
    >
      {toast.text}
    </div>
  );
}
