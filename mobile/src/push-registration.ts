import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export type PushRegistration = {
  token: string;
  platform: "ios" | "android";
};

/**
 * Requests notification permission only when called from an explicit user
 * action. CallBridge never prompts during app startup or registers simulators.
 */
export async function requestExpoPushRegistration(): Promise<PushRegistration> {
  if (!Device.isDevice) throw new Error("Push registration requires a physical device");
  if (Platform.OS !== "ios" && Platform.OS !== "android") {
    throw new Error("Push registration is only available on iOS and Android");
  }

  const current = await Notifications.getPermissionsAsync();
  const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error("Notification permission was not granted");

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (typeof projectId !== "string" || !projectId.trim()) {
    throw new Error("EAS projectId is not configured");
  }

  const result = await Notifications.getExpoPushTokenAsync({ projectId });
  return { token: result.data, platform: Platform.OS };
}
