export type Dialog = "dm" | "group" | "pride" | "channel" | "join" | null;
export const time = (value: number) =>
  value
    ? new Date(value).toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
export const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Что-то пошло не так. Попробуйте снова.";
