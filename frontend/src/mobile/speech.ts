export type RecognitionResult = {
  isFinal: boolean;
  [index: number]: { transcript: string };
};
export type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};
export function recognitionConstructor() {
  const browser = window as SpeechWindow;
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
}
export function speechError(error: string) {
  const messages: Record<string, string> = {
    "not-allowed": "麦克风权限被拒绝，请在浏览器设置中允许后重试。",
    "service-not-allowed": "浏览器未允许语音识别服务，请改用文字录入。",
    "audio-capture": "未找到可用麦克风，请检查设备。",
    network: "语音服务连接失败，请检查网络或改用文字录入。",
    "no-speech": "没有听到清晰的语音，请重试。",
    "language-not-supported": "当前语音服务不支持中文，请改用文字录入。",
  };
  return messages[error] ?? "识别未完成，请重试或改用文字录入。";
}
