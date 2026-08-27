/*
THESIS: CallBridge is a calm cue sheet for stressful calls, not a generic chat.
OWN-WORLD: Ink-black iOS night, a cobalt horizon for live work, rose only for decisions.
STORY: Ask naturally, see only factual work, decide only when it matters.
FIRST VIEWPORT: large question above the active cue, with the composer anchored at the bottom.
FORM: stagecraft cyclorama dawn, seed f06a6885. FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md.
*/
import { StatusBar } from "expo-status-bar";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActionSheetIOS, Alert, Animated, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";

import { isConvexConfigured } from "./src/convex-client";
import { buildDraftFromRequest, convexTaskGateway, isRemoteTaskSyncEnabled } from "./src/convex-task-gateway";
import { MacCompanion } from "./src/MacCompanion";
import { LocalTaskStore, type MobileTask, type TaskStage } from "./src/task-store";

const taskStore = new LocalTaskStore();
type Tab = "chat" | "activity" | "mac" | "you";
const isNativeIOS = Platform.OS === "ios" && typeof document === "undefined";

export default function App() {
  return <SafeAreaProvider><CallBridge /></SafeAreaProvider>;
}

function CallBridge() {
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState<TaskStage>("home");
  const [tab, setTab] = useState<Tab>("chat");
  const [request, setRequest] = useState("");
  const [task, setTask] = useState<MobileTask | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => subscription.remove();
  }, []);
  const go = (next: TaskStage) => { void Haptics.selectionAsync(); setStage(next); };
  const selectTab = (next: Tab) => { setTab(next); go(next === "chat" ? "home" : next === "activity" ? "activity" : next === "mac" ? "mac" : "preferences"); };

  async function createDraft() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const local = taskStore.createDraft(request); setTask(local);
    if (isRemoteTaskSyncEnabled) {
      try { setTask(taskStore.markRemoteCreated(await convexTaskGateway.create(buildDraftFromRequest(request)))); }
      catch { setTask(taskStore.markRemoteFailure("Could not reach your signed-in workspace. Your draft remains on this device.")); }
    }
    go("draft");
  }
  async function confirmDraft() {
    if (!task) return;
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      if (task.remote?.id) {
        await convexTaskGateway.confirm(task.remote.id, task.remote.revision);
        setTask(taskStore.markRemoteConfirmed());
        await convexTaskGateway.requestStart(task.remote.id);
      }
      setTask(taskStore.confirmCurrent());
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      go("active");
    } catch { setTask(taskStore.markRemoteFailure("The server draft changed or is unavailable. Review before trying again.")); }
  }
  async function stop() {
    if (!task) return;
    try {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      if (task.remote?.id) { await convexTaskGateway.stop(task.remote.id); setTask(taskStore.markRemoteStopped()); }
      setTask(taskStore.stopCurrent());
    } catch { setTask(taskStore.markRemoteFailure("Could not stop workspace attempts. Try again when connected.")); }
  }
  function openAttachmentChoice() {
    const options = ["Cancel", "Record a voice note", "Add a link", "Choose a photo"];
    if (isNativeIOS) {
      ActionSheetIOS.showActionSheetWithOptions({ title: "Add context", message: "Prototype only. Nothing is attached or shared in this preview.", options, cancelButtonIndex: 0 }, (index) => {
        if (index > 0) void Haptics.selectionAsync();
      });
      return;
    }
    Alert.alert("Add context", "Prototype only. Nothing is attached or shared in this preview.");
  }

  return <View style={[styles.root, { paddingTop: insets.top }]}>
    <StatusBar style="light" />
    <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(insets.bottom, 20) + 94 }]}>
      <Header connected={isConvexConfigured} />
      <StageTransition stage={stage} reduceMotion={reduceMotion}>
        {stage === "home" && <Home request={request} setRequest={setRequest} onCreate={createDraft} onAttachment={openAttachmentChoice} task={task} onOpenTask={() => task && go(task.stopped ? "activity" : "active")} />}
        {stage === "draft" && task && <Draft task={task} onConfirm={confirmDraft} onEdit={() => go("home")} />}
        {stage === "active" && task && <Active task={task} onTranscript={() => go("transcript")} onMockResult={() => go("decision")} onRetry={() => setTask(taskStore.retryCurrent())} onStop={stop} />}
        {stage === "transcript" && task && <TranscriptPreview onBack={() => go("active")} />}
        {stage === "decision" && <Decision onDone={() => { taskStore.clear(); setTask(null); setRequest(""); go("home"); }} />}
        {stage === "activity" && <Activity task={task} onOpen={() => task && go(task.stopped ? "activity" : "active")} />}
        {stage === "mac" && <MacCompanion />}
        {stage === "preferences" && <You />}
      </StageTransition>
    </ScrollView>
    <TabBar active={tab} onSelect={selectTab} inset={insets.bottom} />
  </View>;
}

function Header({ connected }: { connected: boolean }) { return <View style={styles.header}><Text style={styles.brand}>CallBridge</Text><View style={styles.headerState}><View style={[styles.statusDot, connected && styles.statusLive]} /><Text style={styles.headerStateText}>{connected ? "Workspace" : "Preview"}</Text></View></View>; }
function StageTransition({ stage, reduceMotion, children }: { stage: TaskStage; reduceMotion: boolean; children: ReactNode }) {
  const progress = useRef(new Animated.Value(1)).current;
  const previousStage = useRef(stage);
  useEffect(() => {
    if (previousStage.current === stage) return;
    previousStage.current = stage;
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: reduceMotion ? 120 : 240, useNativeDriver: Platform.OS !== "web" }).start();
  }, [progress, reduceMotion, stage]);
  return <Animated.View style={{ opacity: progress, transform: [{ translateY: reduceMotion ? 0 : progress.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>{children}</Animated.View>;
}
function Symbol({ name, color, size = 18 }: { name: string; color: string; size?: number }) {
  if (isNativeIOS) return <Image source={`sf:${name}`} accessibilityElementsHidden style={{ width: size, height: size, color, fontSize: size, fontWeight: "600" }} contentFit="contain" />;
  return null;
}
function InputAction({ name, label, onPress }: { name: string; label: string; onPress: () => void }) { return <Pressable accessibilityLabel={`Add ${label.toLowerCase()} context`} accessibilityHint="Prototype only. No context is attached yet." onPress={onPress} style={styles.inputAction}><Symbol name={name} color="#B9C2D5" size={18} /><Text style={styles.toolText}>{label}</Text></Pressable>; }
function Home({ request, setRequest, onCreate, onAttachment, task, onOpenTask }: { request: string; setRequest: (value: string) => void; onCreate: () => void; onAttachment: () => void; task: MobileTask | null; onOpenTask: () => void }) { return <View style={styles.screen}><View style={styles.homeHero}><Text style={styles.display}>What can I{`\n`}take care of?</Text><Text style={styles.heroCopy}>I handle the call. You stay in control.</Text></View><View style={styles.horizon} /><View style={styles.homeBody}>{task && <Pressable onPress={onOpenTask} style={styles.activeCue}><View style={styles.cueIcon}><Symbol name="phone.fill" color="#DAE5FF" /></View><View style={styles.cueCopy}><Text style={styles.cueTitle}>{task.request}</Text><Text style={styles.cueDetail}>{task.stopped ? "Future work stopped" : "Open task activity"}</Text></View><Text style={styles.openLabel}>Open</Text></Pressable>}<Text style={styles.suggestionLabel}>Try a task</Text><View style={styles.suggestions}><Suggestion text="Find the best direct rate" onPress={() => setRequest("Find the best direct rate for a hotel")} /><Suggestion text="Talk to my courier" onPress={() => setRequest("Tell my courier where to leave the delivery")} /></View></View><Composer value={request} onChange={setRequest} onSend={onCreate} onAttachment={onAttachment} /></View>; }
function Composer({ value, onChange, onSend, onAttachment }: { value: string; onChange: (value: string) => void; onSend: () => void; onAttachment: () => void }) { return <View style={styles.composer}><TextInput value={value} onChangeText={onChange} placeholder="Ask in your own words…" placeholderTextColor="#6D7280" multiline style={styles.input} accessibilityLabel="Describe what you need" /><View style={styles.composerTools}><InputAction name="mic.fill" label="Voice" onPress={onAttachment} /><InputAction name="link" label="Link" onPress={onAttachment} /><InputAction name="photo" label="Photo" onPress={onAttachment} /><Pressable accessibilityLabel="Create draft" disabled={!value.trim()} onPress={onSend} style={[styles.send, !value.trim() && styles.sendDisabled]}>{isNativeIOS ? <Symbol name="arrow.up" color="#FFFFFF" size={20} /> : <Text style={{ color: "#FFFFFF", fontSize: 13, fontWeight: "800" }}>Go</Text>}</Pressable></View></View>; }
function Draft({ task, onConfirm, onEdit }: { task: MobileTask; onConfirm: () => void; onEdit: () => void }) { return <View style={styles.screen}><Text style={styles.title}>Your call draft</Text><Text style={styles.screenCopy}>Read it once. Nothing happens until you confirm.</Text><View style={styles.draftSheet}><Text style={styles.sheetLabel}>I’ll ask about</Text><Text style={styles.draftTitle}>{task.request}</Text><Rule text="Comparable options" /><Rule text="Total cost and cancellation terms" /><Rule text="Availability in the local language" /></View>{task.remote?.state === "failed" && <Text style={styles.error}>{task.remote.message}</Text>}<Text style={styles.sync}>{task.remote?.state === "synced" ? "Saved to your workspace" : "Saved privately on this device"}</Text><Pressable onPress={onConfirm} style={styles.primary}><Text style={styles.primaryText}>Confirm call</Text></Pressable><Pressable onPress={onEdit} style={styles.textButton}><Text style={styles.textButtonText}>Edit draft</Text></Pressable></View>; }
function Active({ task, onTranscript, onMockResult, onRetry, onStop }: { task: MobileTask; onTranscript: () => void; onMockResult: () => void; onRetry: () => void; onStop: () => void }) { return <View style={styles.screen}><Text style={styles.title}>{task.stopped ? "Task paused" : "Call task"}</Text><Text style={styles.screenCopy}>{task.stopped ? "There will be no more retries or proactive actions." : "Only factual provider events will appear here."}</Text><View style={styles.liveHorizon} /><Text style={styles.timelineLabel}>TODAY</Text><View style={styles.timeline}>{task.activity.map((event, index) => <Cue key={`${event.title}-${index}`} event={event} last={index === task.activity.length - 1} />)}</View>{!task.stopped && <><Pressable onPress={onTranscript} style={styles.transcript}><Text style={styles.transcriptTitle}>Translated transcript prototype</Text><Text style={styles.transcriptDetail}>No transcript is invented while the provider is disconnected</Text></Pressable><Pressable onPress={onMockResult} style={styles.textButton}><Text style={styles.textButtonText}>Open mock result</Text></Pressable><Pressable onPress={onRetry} style={styles.textButton}><Text style={styles.textButtonText}>Retry in 5 minutes</Text></Pressable></>}<Pressable onPress={onStop} disabled={task.stopped} style={styles.stop}><Text style={[styles.stopText, task.stopped && styles.muted]}>Stop future attempts</Text></Pressable></View>; }
function TranscriptPreview({ onBack }: { onBack: () => void }) { return <View style={styles.screen}><Text style={styles.title}>Transcript prototype</Text><Text style={styles.screenCopy}>A signed provider callback will populate this screen. No sample conversation is presented as real.</Text><Pressable onPress={onBack} style={styles.textButton}><Text style={styles.textButtonText}>Back to activity</Text></Pressable></View>; }
function Cue({ event, last }: { event: { title: string; detail: string; emphasis?: boolean }; last: boolean }) { return <View style={styles.cueRow}><View style={styles.timelineRail}><View style={[styles.timelineNode, event.emphasis && styles.timelineNodeLive]} /><View style={[styles.timelineLine, last && styles.timelineLineLast]} /></View><View style={styles.cueEvent}><Text style={styles.cueEventTitle}>{event.title}</Text><Text style={styles.cueEventDetail}>{event.detail}</Text></View></View>; }
function Decision({ onDone }: { onDone: () => void }) { const [open, setOpen] = useState(false); return <View style={styles.screen}><Text style={styles.title}>Decision needed</Text><Text style={styles.screenCopy}>Example data only. A real provider must return verified terms.</Text><View style={styles.decisionSheet}><Text style={styles.option}>Option 1 of 2</Text><Text style={styles.decisionTitle}>Family room · 2 nights</Text><DecisionRow label="Total" value="$240" /><DecisionRow label="Cancellation" value="Free until 18:00" /><DecisionRow label="Taxes" value="Included" /><Pressable onPress={onDone} style={styles.primary}><Text style={styles.primaryText}>Confirm and call back</Text></Pressable><Pressable style={styles.secondaryAction}><Text style={styles.secondaryActionText}>Change</Text></Pressable><Pressable style={styles.secondaryAction}><Text style={styles.secondaryActionText}>Discuss</Text></Pressable></View><Pressable onPress={() => setOpen(!open)} style={styles.cancelTrigger}><Text style={styles.stopText}>Cancel or change</Text></Pressable>{open && <View style={styles.cancelNotice}><Text style={styles.cancelTitle}>Cancellation is free right now</Text><Text style={styles.cancelCopy}>One final confirmation is required before any cancellation contact.</Text></View>}</View>; }
function Activity({ task, onOpen }: { task: MobileTask | null; onOpen: () => void }) { return <View style={styles.screen}><Text style={styles.title}>Activity</Text><Text style={styles.screenCopy}>Everything that needs your attention, in one place.</Text>{task ? <Pressable onPress={onOpen} style={styles.activityRow}><View style={styles.cueIcon}><Symbol name="phone.fill" color="#DAE5FF" /></View><View style={styles.cueCopy}><Text style={styles.cueTitle} numberOfLines={1}>{task.request}</Text><Text style={styles.cueDetail}>{task.stopped ? "Paused" : "In progress"}</Text></View><Text style={styles.openLabel}>Open</Text></Pressable> : <View style={styles.empty}><Text style={styles.emptyTitle}>Nothing needs you yet.</Text><Text style={styles.screenCopy}>Start a task and the useful updates will arrive here.</Text></View>}</View>; }
function You() { const [quiet, setQuiet] = useState(true); const [brief, setBrief] = useState(true); const [memory, setMemory] = useState(true); return <View style={styles.screen}><Text style={styles.title}>You</Text><Text style={styles.screenCopy}>Quiet defaults. You only need to change what matters.</Text><View style={styles.settings}><Setting label="Quiet hours" detail="22:00–08:00 in your time zone" value={quiet} onChange={setQuiet} /><Setting label="Morning brief" detail="Only after important activity" value={brief} onChange={setBrief} /><Setting label="Remember places" detail="Keep a short visit summary" value={memory} onChange={setMemory} /></View><View style={styles.sensitive}><Text style={styles.sensitiveTitle}>Sensitive delivery details</Text><Text style={styles.sensitiveCopy}>I ask every time before sharing an intercom code or entry instruction.</Text></View></View>; }
function Setting({ label, detail, value, onChange }: { label: string; detail: string; value: boolean; onChange: (value: boolean) => void }) { return <View style={styles.setting}><View style={styles.settingCopy}><Text style={styles.settingTitle}>{label}</Text><Text style={styles.settingDetail}>{detail}</Text></View><Switch value={value} onValueChange={onChange} trackColor={{ false: "#3A3D46", true: "#245BD8" }} /></View>; }
function TabBar({ active, onSelect, inset }: { active: Tab; onSelect: (tab: Tab) => void; inset: number }) { const tabConfig: Array<{ id: Tab; label: string; symbol: string }> = [{ id: "chat", label: "Chat", symbol: "message.fill" }, { id: "activity", label: "Activity", symbol: "clock.fill" }, { id: "mac", label: "Mac", symbol: "laptopcomputer" }, { id: "you", label: "You", symbol: "person.fill" }]; return <View style={[styles.tabBar, { paddingBottom: Math.max(inset, 10) }]}>{tabConfig.map(({ id, label, symbol }) => <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: active === id }} onPress={() => onSelect(id)} style={styles.tab}><Symbol name={symbol} color={active === id ? "#6D9DFF" : "#6E7480"} size={18} /><Text style={[styles.tabText, active === id && styles.tabTextActive]}>{label}</Text></Pressable>)}</View>; }
function Suggestion({ text, onPress }: { text: string; onPress: () => void }) { return <Pressable onPress={onPress} style={styles.suggestion}><Text style={styles.suggestionText}>{text}</Text><Text style={styles.openLabel}>Use</Text></Pressable>; }
function Rule({ text }: { text: string }) { return <View style={styles.rule}><View style={styles.ruleDot} /><Text style={styles.ruleText}>{text}</Text></View>; }
function DecisionRow({ label, value }: { label: string; value: string }) { return <View style={styles.decisionRow}><Text style={styles.decisionLabel}>{label}</Text><Text style={styles.decisionValue}>{value}</Text></View>; }

const styles = StyleSheet.create({ root:{ flex:1, backgroundColor:"#050608" }, scroll:{ flexGrow:1, paddingHorizontal:20 }, header:{ minHeight:52, flexDirection:"row", justifyContent:"space-between", alignItems:"center" }, brand:{ color:"#F4F5F7", fontSize:17, fontWeight:"700", letterSpacing:-0.4 }, headerState:{ flexDirection:"row", alignItems:"center", gap:7 }, statusDot:{ width:6, height:6, borderRadius:3, backgroundColor:"#6D7280" }, statusLive:{ backgroundColor:"#4D8BFF" }, headerStateText:{ color:"#9196A3", fontSize:13, fontWeight:"600" }, screen:{ flex:1, gap:18, paddingTop:28 }, homeHero:{ gap:12, paddingTop:20 }, display:{ color:"#F7F8FA", fontSize:42, lineHeight:45, fontWeight:"700", letterSpacing:-1.7 }, heroCopy:{ color:"#AAB0BD", fontSize:17, lineHeight:24 }, horizon:{ height:2, backgroundColor:"#2159E8", marginHorizontal:-20, shadowColor:"#2159E8", shadowOpacity:0.9, shadowRadius:20, shadowOffset:{width:0,height:6} }, homeBody:{ gap:16 }, activeCue:{ minHeight:94, flexDirection:"row", alignItems:"center", padding:16, gap:14, borderRadius:16, backgroundColor:"#111318" }, cueIcon:{ width:46, height:46, borderRadius:23, backgroundColor:"#183D9C", justifyContent:"center", alignItems:"center" }, cueCopy:{ flex:1, gap:3 }, cueTitle:{ color:"#F1F3F7", fontSize:17, fontWeight:"700" }, cueDetail:{ color:"#9DA5B4", fontSize:14, lineHeight:20 }, openLabel:{ color:"#A9B7D4", fontSize:13, fontWeight:"700" }, suggestionLabel:{ color:"#8D94A3", fontSize:13, fontWeight:"700", textTransform:"uppercase", letterSpacing:0.8, marginTop:6 }, suggestions:{ borderRadius:14, overflow:"hidden", backgroundColor:"#111318" }, suggestion:{ minHeight:52, paddingHorizontal:16, flexDirection:"row", alignItems:"center", justifyContent:"space-between", borderBottomWidth:StyleSheet.hairlineWidth, borderBottomColor:"#272A32" }, suggestionText:{ color:"#E8EAF0", fontSize:16 }, composer:{ marginTop:"auto", padding:16, backgroundColor:"#14161B", borderRadius:18, borderWidth:1, borderColor:"#2D3038", gap:12 }, input:{ color:"#F4F5F7", fontSize:17, lineHeight:24, minHeight:82, textAlignVertical:"top" }, composerTools:{ flexDirection:"row", alignItems:"center", gap:7 }, inputAction:{ minWidth:44, minHeight:44, flexDirection:"row", alignItems:"center", justifyContent:"center", gap:5, paddingHorizontal:4 }, toolText:{ color:"#B9C2D5", fontSize:12, fontWeight:"700" }, send:{ marginLeft:"auto", width:44, height:44, borderRadius:22, backgroundColor:"#2E6AFF", justifyContent:"center", alignItems:"center" }, sendDisabled:{ opacity:0.35 }, title:{ color:"#F7F8FA", fontSize:34, lineHeight:39, fontWeight:"700", letterSpacing:-1.2 }, screenCopy:{ color:"#9DA5B4", fontSize:16, lineHeight:23 }, draftSheet:{ borderRadius:18, backgroundColor:"#111318", padding:18, gap:14 }, sheetLabel:{ color:"#8D94A3", fontSize:13, fontWeight:"700", textTransform:"uppercase", letterSpacing:0.8 }, draftTitle:{ color:"#F2F4F8", fontSize:22, lineHeight:29, fontWeight:"700" }, rule:{ flexDirection:"row", alignItems:"center", gap:10 }, ruleDot:{ width:6, height:6, borderRadius:3, backgroundColor:"#4D8BFF" }, ruleText:{ color:"#C5CAD4", fontSize:16 }, sync:{ color:"#8D94A3", fontSize:13 }, error:{ color:"#FF9A96", fontSize:14, lineHeight:20 }, primary:{ minHeight:54, borderRadius:14, backgroundColor:"#2E6AFF", justifyContent:"center", alignItems:"center", marginTop:4 }, primaryText:{ color:"#FFFFFF", fontSize:17, fontWeight:"700" }, textButton:{ minHeight:48, justifyContent:"center", alignItems:"center" }, textButtonText:{ color:"#D9DEEA", fontSize:16, fontWeight:"600" }, liveHorizon:{ height:72, marginHorizontal:-20, marginBottom:4, backgroundColor:"#0B1639", borderBottomWidth:2, borderBottomColor:"#2E6AFF" }, timelineLabel:{ color:"#7E8595", fontSize:12, fontWeight:"700", letterSpacing:0.8 }, timeline:{ gap:0 }, cueRow:{ flexDirection:"row", minHeight:74, gap:14 }, timelineRail:{ width:30, alignItems:"center" }, timelineNode:{ width:12, height:12, borderRadius:6, backgroundColor:"#3A3D46", marginTop:5, zIndex:2 }, timelineNodeLive:{ backgroundColor:"#4D8BFF", shadowColor:"#2E6AFF", shadowOpacity:0.9, shadowRadius:10, shadowOffset:{width:0,height:0} }, timelineLine:{ width:1, flex:1, backgroundColor:"#30333B", marginTop:-2 }, timelineLineLast:{ backgroundColor:"transparent" }, cueEvent:{ flex:1, gap:4, paddingBottom:20 }, cueEventTitle:{ color:"#F0F2F6", fontSize:17, fontWeight:"700" }, cueEventDetail:{ color:"#9DA5B4", fontSize:15, lineHeight:21 }, transcript:{ backgroundColor:"#151820", borderRadius:14, padding:16, gap:4 }, transcriptTitle:{ color:"#F0F2F6", fontSize:16, fontWeight:"700" }, transcriptDetail:{ color:"#9DA5B4", fontSize:14 }, stop:{ minHeight:48, alignItems:"center", justifyContent:"center" }, stopText:{ color:"#FF7772", fontSize:16, fontWeight:"700" }, muted:{ opacity:0.4 }, decisionSheet:{ backgroundColor:"#F7F8FB", borderRadius:22, padding:18, gap:0 }, option:{ color:"#6E7380", fontSize:13, fontWeight:"700" }, decisionTitle:{ color:"#14151A", fontSize:23, lineHeight:29, fontWeight:"700", marginTop:8, marginBottom:12 }, decisionRow:{ minHeight:44, flexDirection:"row", alignItems:"center", justifyContent:"space-between", borderTopWidth:StyleSheet.hairlineWidth, borderTopColor:"#D8DCE5" }, decisionLabel:{ color:"#4A4E58", fontSize:15 }, decisionValue:{ color:"#14151A", fontSize:15, fontWeight:"600" }, secondaryAction:{ minHeight:48, marginTop:8, borderRadius:12, backgroundColor:"#E8EBF2", alignItems:"center", justifyContent:"center" }, secondaryActionText:{ color:"#1E2430", fontSize:16, fontWeight:"700" }, cancelTrigger:{ minHeight:48, justifyContent:"center", alignItems:"center" }, cancelNotice:{ backgroundColor:"#351D25", borderRadius:14, padding:16, gap:6 }, cancelTitle:{ color:"#FFC7C3", fontSize:16, fontWeight:"700" }, cancelCopy:{ color:"#E6ABB0", fontSize:14, lineHeight:20 }, activityRow:{ minHeight:82, flexDirection:"row", alignItems:"center", gap:14, borderRadius:16, padding:16, backgroundColor:"#111318" }, empty:{ gap:8, paddingVertical:36 }, emptyTitle:{ color:"#E8EAF0", fontSize:20, fontWeight:"700" }, settings:{ borderRadius:14, overflow:"hidden", backgroundColor:"#111318" }, setting:{ minHeight:72, paddingHorizontal:16, flexDirection:"row", alignItems:"center", justifyContent:"space-between", gap:16, borderBottomWidth:StyleSheet.hairlineWidth, borderBottomColor:"#282B33" }, settingCopy:{ flex:1, gap:3 }, settingTitle:{ color:"#EFF1F5", fontSize:16, fontWeight:"600" }, settingDetail:{ color:"#969DAB", fontSize:14, lineHeight:19 }, sensitive:{ borderRadius:15, padding:16, gap:6, backgroundColor:"#171A22" }, sensitiveTitle:{ color:"#F2F4F7", fontSize:16, fontWeight:"700" }, sensitiveCopy:{ color:"#A8AFBC", fontSize:14, lineHeight:20 }, tabBar:{ position:"absolute", left:0, right:0, bottom:0, minHeight:62, flexDirection:"row", justifyContent:"space-around", backgroundColor:"#101217", borderTopWidth:StyleSheet.hairlineWidth, borderTopColor:"#272A32" }, tab:{ flex:1, minHeight:52, alignItems:"center", justifyContent:"center", gap:4 }, tabText:{ color:"#8C93A2", fontSize:12, fontWeight:"600" }, tabTextActive:{ color:"#EAF0FF" } });
