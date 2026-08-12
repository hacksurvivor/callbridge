import { StatusBar } from "expo-status-bar";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { LocalTaskStore, type MobileTask, type TaskStage } from "./src/task-store";

const taskStore = new LocalTaskStore();

export default function App() {
  const [stage, setStage] = useState<TaskStage>("home");
  const [request, setRequest] = useState("");
  const [task, setTask] = useState<MobileTask | null>(null);
  const advance = (next: TaskStage) => {
    void Haptics.selectionAsync();
    setStage(next);
  };

  return (
    <View style={styles.app}>
      <StatusBar style="dark" />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        <Text style={styles.wordmark}>CallBridge</Text>
        {stage === "home" && <Home request={request} setRequest={setRequest} onContinue={() => { setTask(taskStore.createDraft(request)); advance("draft"); }} />}
        {stage === "draft" && task && <Draft request={task.request} onConfirm={() => { setTask(taskStore.confirmCurrent()); advance("active"); }} onBack={() => advance("home")} />}
        {stage === "active" && task && <Active task={task} onResult={() => { setTask(taskStore.prepareDecision()); advance("decision"); }} />}
        {stage === "decision" && <Decision onDone={() => { taskStore.clear(); setTask(null); setRequest(""); advance("home"); }} />}
      </ScrollView>
    </View>
  );
}

function Home({ request, setRequest, onContinue }: { request: string; setRequest: (value: string) => void; onContinue: () => void }) {
  return <View style={styles.home}><View style={styles.hero}><Text style={styles.title}>What do you need done?</Text><Text style={styles.subtle}>Write it, add a link, or send a voice note. I’ll make a draft before anything happens.</Text></View>
    <View style={styles.composer}><TextInput value={request} onChangeText={setRequest} placeholder="Find a hotel in Bangkok for my family…" placeholderTextColor="#8D8D91" multiline style={styles.input} /><View style={styles.composerRow}><Text style={styles.icon}>＋</Text><Text style={styles.icon}>◉</Text><Pressable accessibilityRole="button" onPress={onContinue} style={[styles.send, !request.trim() && styles.disabled]} disabled={!request.trim()}><Text style={styles.sendText}>Draft</Text></Pressable></View></View>
    <Text style={styles.sectionTitle}>Try asking</Text><View style={styles.chips}><Chip text="Find the best direct rate" onPress={() => { setRequest("Find the best direct rate for a hotel"); }} /><Chip text="Talk to my courier" onPress={() => { setRequest("Tell my courier where to leave the delivery"); }} /><Chip text="Book a table" onPress={() => { setRequest("Find a quiet table for dinner"); }} /></View>
    <View style={styles.recent}><Text style={styles.sectionTitle}>Recent</Text><Text style={styles.recentTitle}>Bangkok stay</Text><Text style={styles.subtle}>Waiting for your call confirmation</Text></View></View>;
}

function Draft({ request, onConfirm, onBack }: { request: string; onConfirm: () => void; onBack: () => void }) { return <View style={styles.stack}><Text style={styles.title}>Here’s the draft</Text><Text style={styles.subtle}>Nothing will be sent or called until you confirm.</Text><View style={styles.card}><Text style={styles.cardLabel}>I’ll ask about</Text><Text style={styles.cardTitle} selectable>{request}</Text><Text style={styles.cardDetail}>• comparable options{`\n`}• total price and terms{`\n`}• availability in the local language</Text></View><View style={styles.notice}><Text style={styles.noticeTitle}>You stay in control</Text><Text style={styles.noticeText}>I can gather options. I can’t book, pay, or accept terms.</Text></View><Pressable accessibilityRole="button" style={styles.primary} onPress={onConfirm}><Text style={styles.primaryText}>Confirm call</Text></Pressable><Pressable accessibilityRole="button" style={styles.secondary} onPress={onBack}><Text style={styles.secondaryText}>Edit draft</Text></Pressable></View>; }
function Active({ task, onResult }: { task: MobileTask; onResult: () => void }) { return <View style={styles.stack}><Text style={styles.title}>Working on it</Text><Text style={styles.subtle}>You can follow along. The translated transcript is available when you need it.</Text><View style={styles.feed}>{task.activity.map((item) => <Feed key={item.title} text={item.title} meta={item.detail} strong={item.emphasis} />)}</View><Pressable accessibilityRole="button" style={styles.primary} onPress={onResult}><Text style={styles.primaryText}>Show result</Text></Pressable><Pressable accessibilityRole="button" style={styles.stop}><Text style={styles.stopText}>Stop future attempts</Text></Pressable></View>; }
function Decision({ onDone }: { onDone: () => void }) { return <View style={styles.stack}><Text style={styles.title}>A good option is ready</Text><View style={styles.card}><Text style={styles.cardLabel}>Hotel response</Text><Text style={styles.cardTitle}>Family room · 2 nights</Text><Text style={styles.price}>$240 total</Text><Text style={styles.cardDetail}>Taxes included · free cancellation until 18:00 tomorrow</Text></View><Text style={styles.subtle}>The hotel is waiting. I won’t confirm anything without you.</Text><Pressable accessibilityRole="button" style={styles.primary} onPress={onDone}><Text style={styles.primaryText}>Confirm and call back</Text></Pressable><Pressable accessibilityRole="button" style={styles.secondary}><Text style={styles.secondaryText}>Change or discuss</Text></Pressable></View>; }
function Chip({ text, onPress }: { text: string; onPress: () => void }) { return <Pressable onPress={onPress} style={styles.chip}><Text style={styles.chipText}>{text}</Text></Pressable>; }
function Feed({ text, meta, strong }: { text: string; meta: string; strong?: boolean }) { return <View style={[styles.feedItem, strong && styles.feedStrong]}><Text style={styles.feedText}>{text}</Text><Text style={styles.feedMeta}>{meta}</Text></View>; }

const styles = StyleSheet.create({ app:{flex:1,backgroundColor:"#F7F7F5"},content:{padding:24,gap:28},wordmark:{fontSize:17,fontWeight:"700",letterSpacing:-.3,color:"#171717"},home:{gap:28,paddingTop:54},hero:{gap:12},title:{fontSize:34,lineHeight:39,fontWeight:"700",letterSpacing:-1.1,color:"#171717"},subtle:{fontSize:16,lineHeight:23,color:"#68686C"},composer:{backgroundColor:"#FFF",padding:16,borderRadius:18,gap:12,boxShadow:"0 10px 30px rgba(25,25,25,.07)"},input:{fontSize:17,lineHeight:24,minHeight:92,color:"#171717",textAlignVertical:"top"},composerRow:{flexDirection:"row",alignItems:"center",gap:14},icon:{fontSize:22,color:"#666"},send:{marginLeft:"auto",backgroundColor:"#171717",paddingHorizontal:16,paddingVertical:10,borderRadius:999},disabled:{opacity:.35},sendText:{color:"#FFF",fontWeight:"700"},sectionTitle:{fontSize:15,fontWeight:"700",color:"#222"},chips:{gap:10,alignItems:"flex-start"},chip:{paddingHorizontal:14,paddingVertical:11,borderRadius:14,backgroundColor:"#ECECE9"},chipText:{color:"#353535",fontSize:15},recent:{gap:6,paddingTop:12},recentTitle:{fontSize:17,fontWeight:"600",color:"#222"},stack:{paddingTop:42,gap:18},card:{backgroundColor:"#FFF",borderRadius:18,padding:20,gap:10,boxShadow:"0 8px 28px rgba(25,25,25,.06)"},cardLabel:{fontSize:14,fontWeight:"700",color:"#777"},cardTitle:{fontSize:21,lineHeight:28,fontWeight:"700",color:"#171717"},cardDetail:{fontSize:16,lineHeight:24,color:"#5C5C60"},notice:{padding:16,backgroundColor:"#E9EEF8",borderRadius:16,gap:4},noticeTitle:{fontSize:16,fontWeight:"700",color:"#23304A"},noticeText:{fontSize:15,lineHeight:21,color:"#41506A"},primary:{backgroundColor:"#171717",padding:17,borderRadius:16,alignItems:"center"},primaryText:{color:"#FFF",fontSize:17,fontWeight:"700"},secondary:{padding:14,alignItems:"center"},secondaryText:{color:"#3C3C40",fontSize:16,fontWeight:"600"},feed:{gap:10},feedItem:{padding:17,borderRadius:16,backgroundColor:"#ECECE9",gap:5},feedStrong:{backgroundColor:"#E5ECFA"},feedText:{fontSize:16,fontWeight:"600",color:"#26262A"},feedMeta:{fontSize:14,color:"#717176"},stop:{padding:14,alignItems:"center"},stopText:{color:"#B3261E",fontSize:16,fontWeight:"600"},price:{fontSize:30,fontWeight:"700",letterSpacing:-.8,color:"#171717"} });
