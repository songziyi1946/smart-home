import { useRef, useState } from "react";
import { Modal } from "@arco-design/web-react";
type Confirmation = {
  title: string;
  description: string;
  confirmText?: string;
  danger?: boolean;
  action: () => Promise<boolean>;
};
/** One confirmation pattern for destructive actions and whole-scene retries. */
export function useConfirmAction(disabled: boolean) {
  const [request, setRequest] = useState<Confirmation>(),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const locked = useRef(false);
  const cancel = () => {
    if (!locked.current) {
      setRequest(undefined);
      setError("");
    }
  };
  const submit = async () => {
    if (!request || disabled || locked.current) return;
    locked.current = true;
    setPending(true);
    setError("");
    try {
      if (await request.action()) setRequest(undefined);
      else setError("操作未完成，请查看错误提示后重试。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作未完成，请重试。");
    } finally {
      locked.current = false;
      setPending(false);
    }
  };
  return {
    ask: (next: Confirmation) => {
      if (!locked.current) {
        setError("");
        setRequest(next);
      }
    },
    dialog: (
      <Modal
        visible={!!request}
        title={request?.title}
        onCancel={cancel}
        onOk={() => void submit()}
        confirmLoading={pending}
        okText={request?.confirmText ?? "确认"}
        cancelText="取消"
        okButtonProps={{
          disabled,
          status: request?.danger ? "danger" : undefined,
        }}
        cancelButtonProps={{ disabled: pending }}
        focusLock
        autoFocus
      >
        <p>{request?.description}</p>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </Modal>
    ),
  };
}
