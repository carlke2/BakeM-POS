import Swal from "sweetalert2";

const fire = (
  icon: "success" | "error" | "warning" | "info",
  message: string,
  description?: string
) => {
  if (icon === "success") {
    return Swal.fire({
      icon,
      title: message,
      text: description,
      timer: 1200,
      showConfirmButton: false,
      timerProgressBar: true,
    });
  }

  return Swal.fire({
    icon,
    title: message,
    text: description,
  });
};

export const toast = {
  success: (message: string, description?: string) =>
    fire("success", message, description),

  error: (message: string, description?: string) =>
    fire("error", message, description),

  warning: (message: string, description?: string) =>
    fire("warning", message, description),

  info: (message: string, description?: string) =>
    fire("info", message, description),

  /** Dialog with confirm / cancel - resolves true when confirmed */
  confirm: (
    message: string,
    options?: { description?: string; confirmLabel?: string; cancelLabel?: string }
  ): Promise<boolean> =>
    Swal.fire({
      title: message,
      text: options?.description,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: options?.confirmLabel ?? "Confirm",
      cancelButtonText: options?.cancelLabel ?? "Cancel",
    }).then((result) => result.isConfirmed),
};
