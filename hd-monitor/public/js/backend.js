// 데이터 연결: Firebase (Auth · Firestore 'hdmon' 데이터베이스 · Functions 서울 리전)
// 주소 끝에 ?demo 를 붙이면 Firebase 없이 예시 데이터로 화면만 볼 수 있음
const V = "10.14.1";
export const IS_DEMO = new URLSearchParams(location.search).has("demo");

export async function createBackend() {
  if (IS_DEMO) return (await import("./demo.js")).createDemoBackend();

  const cfg = await (await fetch("/__/firebase/init.json")).json();
  const [{ initializeApp }, A, F, Fn] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-functions.js`),
  ]);
  const app = initializeApp(cfg);
  const auth = A.getAuth(app);
  const db = F.getFirestore(app, "hdmon");
  const fns = Fn.getFunctions(app, "asia-northeast3");
  const call = async (name, data) => {
    try {
      return (await Fn.httpsCallable(fns, name, { timeout: 540000 })(data)).data;
    } catch (e) {
      throw new Error(e.message?.replace(/^.*?:\s*/, "") || String(e));
    }
  };
  const { collection, doc, getDoc, getDocs, setDoc, updateDoc, query, where, orderBy, limit, startAfter, onSnapshot, Timestamp, serverTimestamp } = F;

  return {
    demo: false,
    onAuth: (cb) => A.onAuthStateChanged(auth, cb),
    signIn: (email, pw) => A.signInWithEmailAndPassword(auth, email, pw),
    signUp: async (email, pw) => A.createUserWithEmailAndPassword(auth, email, pw),
    signOut: () => A.signOut(auth),
    resetPw: (email) => A.sendPasswordResetEmail(auth, email),
    currentEmail: () => auth.currentUser?.email,
    me: (extra) => call("me", extra || {}),

    getSettings: async () => (await getDoc(doc(db, "settings/main"))).data(),
    watchSettings: (cb) => onSnapshot(doc(db, "settings/main"), (s) => cb(s.data())),
    saveSettings: (patch) => setDoc(doc(db, "settings/main"), { ...patch, updatedAt: serverTimestamp() }, { merge: true }),
    resetSettings: (key) => call("resetSettings", { key }),

    async listPosts({ cat = "all", from, to, sort = "time", pageSize = 200, cursor = null }) {
      const cons = [where("cats", "array-contains", cat)];
      if (from) cons.push(where(sort, ">=", Timestamp.fromDate(from)));
      if (to) cons.push(where(sort, "<", Timestamp.fromDate(to)));
      cons.push(orderBy(sort, "desc"), limit(pageSize));
      if (cursor) cons.push(startAfter(cursor));
      const snap = await getDocs(query(collection(db, "posts"), ...cons));
      return { items: snap.docs.map((d) => ({ id: d.id, ...d.data() })), cursor: snap.docs[snap.docs.length - 1] || null, done: snap.size < pageSize };
    },
    updatePost: (id, patch) => updateDoc(doc(db, "posts", id), patch),
    watchLive: (cb) => onSnapshot(doc(db, "status/live"), (s) => cb(s.data() || { items: [] })),
    watchStatus: (cb) => onSnapshot(doc(db, "status/main"), (s) => cb(s.data() || {})),
    async getStats(fromDay, toDay) {
      const snap = await getDocs(query(collection(db, "stats"), where("day", ">=", fromDay), where("day", "<=", toDay)));
      return snap.docs.map((d) => d.data());
    },
    getRuns: async () => (await getDoc(doc(db, "state/runs"))).data()?.items || [],
    analyze: (ids) => call("analyze", { ids }),
    runNow: (parts) => call("runNow", { parts }),
    reclassify: (days) => call("reclassify", { days }),

    listUsers: async () => (await getDocs(collection(db, "users"))).docs.map((d) => ({ uid: d.id, ...d.data() })),
    updateUser: (uid, patch) => updateDoc(doc(db, "users", uid), patch),
    createUser: (data) => call("adminCreateUser", data),
    deleteUser: (uid, deleteAccount) => call("adminDeleteUser", { uid, deleteAccount }),
    updateMe: (patch) => updateDoc(doc(db, "users", auth.currentUser.uid), patch),

    secretsStatus: () => call("secretsStatus"),
    saveSecrets: (patch) => call("saveSecrets", { ...patch, siteUrl: location.origin }),
    kakaoConnect: (code, redirectUri) => call("kakaoConnect", { code, redirectUri }),
    kakaoTest: () => call("kakaoTest"),
    kakaoUnlink: () => call("kakaoUnlink"),
  };
}
