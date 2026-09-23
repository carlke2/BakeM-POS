import Swal from "sweetalert2";

const SUCCESS = "#5C0101";
const PROGRESS = "#B91D2D";

const fire = (
  icon: "success" | "error" | "warning" | "info",
  message: string,
  description?: string
) => {
  if (icon === "success") {
    return Swal.fire({
      icon,
      iconColor: SUCCESS,
      title: message,
      text: description,
      timer: 1200,
      showConfirmButton: false,
      timerProgressBar: true,
      didOpen: () => {
        const bar = Swal.getTimerProgressBar();
        if (bar) bar.style.backgroundColor = PROGRESS;
      },
    });
  }

  return Swal.fire({
    icon,
    iconColor: icon === "warning" ? "#B91D2D" : icon === "info" ? "#5C0101" : undefined,
    title: message,
    text: description,
    confirmButtonColor: "#B91D2D",
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
      iconColor: "#B91D2D",
      showCancelButton: true,
      confirmButtonColor: "#B91D2D",
      cancelButtonColor: "#5C0101",
      confirmButtonText: options?.confirmLabel ?? "Confirm",
      cancelButtonText: options?.cancelLabel ?? "Cancel",
    }).then((result) => result.isConfirmed),
};
