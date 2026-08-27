import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { macCompanionGateway, type MacCommand, type MacCommandKind, type PairedMac } from "./mac-companion-gateway";

const isNativeIOS = Platform.OS === "ios" && typeof document === "undefined";

function Symbol({ name, color, size = 18 }: { name: string; color: string; size?: number }) {
  if (!isNativeIOS) return null;
  return <Image source={`sf:${name}`} accessibilityElementsHidden style={{ width: size, height: size, color, fontSize: size, fontWeight: "600" }} contentFit="contain" />;
}

function stateLabel(state: MacCommand["state"]): string {
  return ({ pending: "Waiting", running: "Running", cancellation_requested: "Stopping", succeeded: "Done", failed: "Failed", cancelled: "Cancelled" })[state];
}

export function MacCompanion() {
  const [pairing, setPairing] = useState<PairedMac | null>(null);
  const [pairingToken, setPairingToken] = useState("");
  const [instruction, setInstruction] = useState("");
  const [commands, setCommands] = useState<MacCommand[]>([]);
  const [hostOnline, setHostOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (activePairing: PairedMac) => {
    try {
      const list = await macCompanionGateway.list(activePairing);
      setCommands(list.commands);
      setHostOnline(list.host.state === "online" && Date.now() - Date.parse(list.host.lastSeenAt) < 45_000);
      setError(null);
    } catch (caught) {
      setHostOnline(false);
      setError(caught instanceof Error ? caught.message : "Could not reach the Mac relay.");
    }
  }, []);

  useEffect(() => {
    void macCompanionGateway.loadPairing()
      .then((stored) => {
        setPairing(stored);
        if (stored) void refresh(stored);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not read the paired Mac."));
  }, [refresh]);

  useEffect(() => {
    if (!pairing) return;
    const interval = setInterval(() => { void refresh(pairing); }, 3_000);
    return () => clearInterval(interval);
  }, [pairing, refresh]);

  async function pair() {
    setBusy(true);
    setError(null);
    try {
      const connected = await macCompanionGateway.pair(pairingToken);
      setPairing(connected);
      setPairingToken("");
      await refresh(connected);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Pairing failed.");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBusy(false);
    }
  }

  async function enqueue(kind: MacCommandKind) {
    if (!pairing) return;
    const task = instruction.trim();
    if (kind === "agent_task" && !task) return;
    setBusy(true);
    setError(null);
    try {
      await macCompanionGateway.enqueue(pairing, kind, task);
      if (kind === "agent_task") setInstruction("");
      await refresh(pairing);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The command could not be queued.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(commandId: string) {
    if (!pairing) return;
    try {
      await macCompanionGateway.cancel(pairing, commandId);
      await refresh(pairing);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The task could not be stopped.");
    }
  }

  async function forget() {
    await macCompanionGateway.forget();
    setPairing(null);
    setCommands([]);
    setHostOnline(false);
    setError(null);
  }

  if (!pairing) {
    return <View style={styles.screen}>
      <Text style={styles.title}>Pair your Mac</Text>
      <Text style={styles.copy}>Copy the pairing token from the CallBridge menu-bar app.</Text>
      <TextInput
        accessibilityLabel="Mac pairing token"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setPairingToken}
        placeholder="callbridge://pair?..."
        placeholderTextColor="#6D7280"
        secureTextEntry
        style={styles.tokenInput}
        value={pairingToken}
      />
      {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <Pressable accessibilityRole="button" disabled={busy || !pairingToken.trim()} onPress={() => void pair()} style={[styles.primary, (busy || !pairingToken.trim()) && styles.disabled]}>
        <Text style={styles.primaryText}>{busy ? "Pairing..." : "Pair Mac"}</Text>
      </Pressable>
    </View>;
  }

  return <View style={styles.screen}>
    <View style={styles.hostRow}>
      <View style={styles.hostIcon}><Symbol name="laptopcomputer" color="#EAF0FF" size={22} /></View>
      <View style={styles.hostCopy}>
        <Text style={styles.hostName}>{pairing.displayName}</Text>
        <Text style={[styles.hostState, hostOnline && styles.online]}>{hostOnline ? "Online" : "Not responding"}</Text>
      </View>
      <Pressable accessibilityLabel="Forget paired Mac" onPress={() => void forget()} style={styles.iconButton}>
        <Symbol name="xmark" color="#AAB0BD" />
        {!isNativeIOS && <Text style={styles.fallbackIcon}>X</Text>}
      </Pressable>
    </View>

    <View style={styles.composer}>
      <TextInput
        accessibilityLabel="Instruction for Mac"
        maxLength={4_000}
        multiline
        onChangeText={setInstruction}
        placeholder="Give your Mac a task"
        placeholderTextColor="#6D7280"
        style={styles.instruction}
        value={instruction}
      />
      <View style={styles.composerFooter}>
        <Text style={styles.count}>{instruction.length}/4000</Text>
        <Pressable accessibilityLabel="Run task on Mac" disabled={busy || !instruction.trim() || !hostOnline} onPress={() => void enqueue("agent_task")} style={[styles.runButton, (busy || !instruction.trim() || !hostOnline) && styles.disabled]}>
          <Symbol name="arrow.up" color="#FFFFFF" size={19} />
          {!isNativeIOS && <Text style={styles.primaryText}>Run</Text>}
        </Pressable>
      </View>
    </View>

    <View style={styles.controls}>
      <Control label="Status" symbol="waveform.path.ecg" onPress={() => void enqueue("status")} disabled={busy || !hostOnline} />
      <Control label="Summary" symbol="text.justify.left" onPress={() => void enqueue("summarize_recent")} disabled={busy || !hostOnline} />
      <Control label="Pause" symbol="pause.fill" onPress={() => void enqueue("pause_history")} disabled={busy || !hostOnline} />
      <Control label="Resume" symbol="play.fill" onPress={() => void enqueue("resume_history")} disabled={busy || !hostOnline} />
    </View>

    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}

    <Text style={styles.sectionLabel}>RECENT MAC TASKS</Text>
    <View style={styles.commandList}>
      {commands.length === 0 ? <Text style={styles.empty}>No Mac tasks yet.</Text> : commands.map((command) => (
        <View key={command.commandId} style={styles.commandRow}>
          <View style={[styles.stateRail, command.state === "running" && styles.stateRunning, command.state === "failed" && styles.stateFailed]} />
          <View style={styles.commandCopy}>
            <View style={styles.commandHeader}>
              <Text style={styles.commandTitle} numberOfLines={2}>{command.instruction ?? command.kind.replaceAll("_", " ")}</Text>
              <Text style={styles.commandState}>{stateLabel(command.state)}</Text>
            </View>
            {(command.resultSummary || command.failureReason || command.events?.at(-1)?.message) && <Text style={styles.commandResult} numberOfLines={4}>{command.resultSummary ?? command.failureReason ?? command.events?.at(-1)?.message}</Text>}
          </View>
          {(command.state === "pending" || command.state === "running" || command.state === "cancellation_requested") && <Pressable accessibilityLabel="Stop Mac task" disabled={command.state === "cancellation_requested"} onPress={() => void cancel(command.commandId)} style={styles.stopButton}>
            <Symbol name="stop.fill" color="#FF8B86" size={15} />
            {!isNativeIOS && <Text style={styles.stopFallback}>Stop</Text>}
          </Pressable>}
        </View>
      ))}
    </View>
  </View>;
}

function Control({ label, symbol, onPress, disabled }: { label: string; symbol: string; onPress: () => void; disabled: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${label} on Mac`} disabled={disabled} onPress={onPress} style={[styles.control, disabled && styles.disabled]}>
    <Symbol name={symbol} color="#BFD0F5" size={17} />
    <Text style={styles.controlText}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, gap: 18, paddingTop: 28 },
  title: { color: "#F7F8FA", fontSize: 34, lineHeight: 39, fontWeight: "700" },
  copy: { color: "#9DA5B4", fontSize: 16, lineHeight: 23 },
  tokenInput: { minHeight: 52, borderWidth: 1, borderColor: "#343842", borderRadius: 8, paddingHorizontal: 14, color: "#F4F5F7", backgroundColor: "#111318", fontSize: 15 },
  primary: { minHeight: 52, borderRadius: 8, backgroundColor: "#2E6AFF", justifyContent: "center", alignItems: "center" },
  primaryText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  disabled: { opacity: 0.38 },
  error: { color: "#FF9A96", fontSize: 14, lineHeight: 20 },
  hostRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 12 },
  hostIcon: { width: 48, height: 48, borderRadius: 8, backgroundColor: "#183D9C", alignItems: "center", justifyContent: "center" },
  hostCopy: { flex: 1, gap: 3 },
  hostName: { color: "#F2F4F8", fontSize: 19, fontWeight: "700" },
  hostState: { color: "#FF9A96", fontSize: 13, fontWeight: "700" },
  online: { color: "#67C58B" },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  fallbackIcon: { color: "#AAB0BD", fontWeight: "700" },
  composer: { borderRadius: 8, borderWidth: 1, borderColor: "#30343E", backgroundColor: "#14161B", padding: 14, gap: 10 },
  instruction: { color: "#F4F5F7", minHeight: 104, fontSize: 17, lineHeight: 24, textAlignVertical: "top" },
  composerFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  count: { color: "#777E8C", fontSize: 12 },
  runButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#2E6AFF", alignItems: "center", justifyContent: "center" },
  controls: { flexDirection: "row", gap: 6 },
  control: { flex: 1, minHeight: 54, alignItems: "center", justifyContent: "center", gap: 5, borderRadius: 8, backgroundColor: "#171A20" },
  controlText: { color: "#BFD0F5", fontSize: 11, fontWeight: "700" },
  sectionLabel: { color: "#8D94A3", fontSize: 12, fontWeight: "700", letterSpacing: 0.8, marginTop: 2 },
  commandList: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#292D35" },
  empty: { color: "#8D94A3", fontSize: 15, paddingVertical: 22 },
  commandRow: { minHeight: 76, flexDirection: "row", alignItems: "stretch", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#292D35" },
  stateRail: { width: 3, backgroundColor: "#4D8BFF", marginVertical: 12, marginRight: 12 },
  stateRunning: { backgroundColor: "#67C58B" },
  stateFailed: { backgroundColor: "#FF7772" },
  commandCopy: { flex: 1, justifyContent: "center", gap: 6, paddingVertical: 12 },
  commandHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  commandTitle: { flex: 1, color: "#EFF1F5", fontSize: 15, lineHeight: 20, fontWeight: "600", textTransform: "none" },
  commandState: { color: "#8FAEF1", fontSize: 12, fontWeight: "700" },
  commandResult: { color: "#9DA5B4", fontSize: 13, lineHeight: 18 },
  stopButton: { width: 44, alignItems: "center", justifyContent: "center" },
  stopFallback: { color: "#FF8B86", fontSize: 11, fontWeight: "700" },
});
