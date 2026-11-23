export function devicePanelNavigation(currentDevice: string | undefined, nextDevice: unknown, samePage: boolean) {
  if (!samePage) return;
  const deviceId = typeof nextDevice === 'string' ? nextDevice : undefined;
  if (!currentDevice && !deviceId) return;
  return { deviceId, panelOpen: !deviceId };
}
