import { useEffect, useRef, useState } from "react";
import { Button, Drawer } from "@arco-design/web-react";
import { Mic, Square, X } from "lucide-react";
import {
  recognitionConstructor,
  speechError,
  type Recognition,
} from "./speech";

export default function VoiceEntry({
  purpose,
  onClose,
  onDraft,
}: {
  purpose: string;
  onClose: () => void;
  onDraft: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const recognizer = useRef<Recognition>();
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const received = useRef(false);
  const failed = useRef(false);
  const Constructor = recognitionConstructor();
  const available = !!Constructor && window.isSecureContext;

  function release() {
    clearTimeout(timer.current);
    const current = recognizer.current;
    recognizer.current = undefined;
    if (current) {
      current.onresult = null;
      current.onerror = null;
      current.onend = null;
      current.abort();
    }
  }
  useEffect(() => {
    const stopWhenHidden = () => {
      if (document.hidden) {
        release();
        setListening(false);
      }
    };
    document.addEventListener("visibilitychange", stopWhenHidden);
    return () => {
      document.removeEventListener("visibilitychange", stopWhenHidden);
      release();
    };
  }, []);

  function start() {
    if (!available || !Constructor || recognizer.current) return;
    setError("");
    setText("");
    received.current = false;
    failed.current = false;
    const current = new Constructor();
    current.lang = "zh-CN";
    current.continuous = false;
    current.interimResults = true;
    recognizer.current = current;
    current.onresult = (event) => {
      if (recognizer.current !== current) return;
      const transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join("");
      received.current = !!transcript.trim();
      setText(transcript.slice(0, 500));
    };
    current.onerror = (event) => {
      if (recognizer.current !== current) return;
      failed.current = true;
      setError(speechError(event.error));
      release();
      setListening(false);
    };
    current.onend = () => {
      if (recognizer.current !== current) return;
      if (!received.current && !failed.current)
        setError("没有识别到内容，请重试或输入文字。");
      release();
      setListening(false);
    };
    try {
      setListening(true);
      current.start();
      timer.current = setTimeout(() => {
        release();
        setListening(false);
        setError("本次录入已结束，请检查文字，或重新录入。");
      }, 60000);
    } catch {
      release();
      setListening(false);
      setError("无法启动语音识别，请检查麦克风权限后重试。");
    }
  }

  return (
    <Drawer
      visible
      title={null}
      closable={false}
      footer={null}
      placement="bottom"
      height="auto"
      onCancel={onClose}
      focusLock
      autoFocus
      className="voice-drawer"
    >
      <div className="voice-heading">
        <h2>{purpose}</h2>
        <button aria-label="关闭语音录入" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <p className="today-demo-note">
        演示草稿 · 未应用
      </p>
      {available ? (
        <p className="voice-service-note">
          点击开始后使用浏览器语音服务，音频可能由其在线服务处理。
        </p>
      ) : (
        <p role="status" className="voice-service-note">
          {!window.isSecureContext
            ? "语音需要 HTTPS 或本机 localhost，请使用安全地址访问。"
            : "当前浏览器不支持语音识别，可使用输入法语音或文字录入。"}
        </p>
      )}
      <Button
        long
        type="primary"
        disabled={!available}
        icon={listening ? <Square size={18} /> : <Mic size={18} />}
        onClick={() => {
          if (listening) recognizer.current?.stop();
          else start();
        }}
      >
        {listening ? "结束录音" : text ? "重新语音录入" : "开始语音录入"}
      </Button>
      {listening && <p className="voice-status" role="status">正在聆听…</p>}
      <label className="voice-text">
        录入内容
        <textarea
          value={text}
          maxLength={500}
          disabled={listening}
          placeholder="例如：今天晚一小时回家"
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <Button
        long
        disabled={listening || !text.trim()}
        onClick={() => {
          onDraft(text.trim());
          onClose();
        }}
      >
        保留演示草稿
      </Button>
    </Drawer>
  );
}
