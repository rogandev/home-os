// Native macOS WebKit fixture runner; no browser install, real account or production requests.
// Start the Vite razor fixture on 127.0.0.1:5179, then:
// swift -module-cache-path /tmp/razor-swift-cache tests/browser/razors.swift /absolute/evidence/path
import AppKit
import WebKit
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let output = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "/tmp/razor-webkit-qa"
try FileManager.default.createDirectory(atPath: output, withIntermediateDirectories: true)
struct QAFailure: Error { let message: String }
@MainActor final class Probe: NSObject, WKNavigationDelegate {
 var web: WKWebView!
 var window: NSWindow!
 var continuation: CheckedContinuation<Void, Never>?
 var results: [[String: Any]] = []
 func start() {
  let config = WKWebViewConfiguration()
  config.websiteDataStore = .nonPersistent()
  let monitor = WKUserScript(source: "window.__qaErrors=[];addEventListener('error',e=>window.__qaErrors.push(e.message));addEventListener('unhandledrejection',e=>window.__qaErrors.push(String(e.reason)));", injectionTime: .atDocumentStart, forMainFrameOnly: true)
  config.userContentController.addUserScript(monitor)
  web = WKWebView(frame: NSRect(x:0,y:0,width:390,height:844), configuration:config)
  web.navigationDelegate = self
  window = NSWindow(contentRect:NSRect(x:-10000,y:-10000,width:390,height:844),styleMask:.borderless,backing:.buffered,defer:false)
  window.contentView = web
  window.orderBack(nil)
  Task { @MainActor in
   do {try await run();try save();print("PASS local WebKit razor QA: \(results.count) checks; evidence \(output)");exit(0)}
   catch {print("FAIL \(error)");if let measurements=try? await js("JSON.stringify([...document.querySelectorAll('.razor-panel button,.razor-panel input,.razor-panel select')].map(e=>({tag:e.tagName,type:e.type,text:e.textContent,height:e.getBoundingClientRect().height})))") {print(measurements)};try? await screenshot("failure");try? save();exit(1)}
  }
 }
 func webView(_ webView:WKWebView,didFinish navigation:WKNavigation!) {continuation?.resume();continuation=nil}
 func webView(_ webView:WKWebView,decidePolicyFor action:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void) {decisionHandler(action.request.url?.host == "127.0.0.1" ? .allow : .cancel)}
 func save() throws {try JSONSerialization.data(withJSONObject:results,options:[.prettyPrinted,.sortedKeys]).write(to:URL(fileURLWithPath:output+"/results.json"))}
 func js(_ code:String) async throws -> Any {try await web.evaluateJavaScript(code) ?? NSNull()}
 func check(_ code:String,_ name:String) async throws {
  let value=try await js("Boolean((()=>{\(code)})())") as? Bool ?? false
  results.append(["check":name,"passed":value]);if !value {throw QAFailure(message:name)}
 }
 func waitFor(_ expression:String) async throws {
  for _ in 0..<100 {if (try await js("Boolean(\(expression))") as? Bool)==true{return};try await Task.sleep(nanoseconds:50_000_000)}
  throw QAFailure(message:"Timed out: "+expression)
 }
 func load(_ query:String="",_ width:Int=390,_ height:Int=844) async throws {
  window.setContentSize(NSSize(width:width,height:height));web.frame=NSRect(x:0,y:0,width:width,height:height)
  await withCheckedContinuation { (c:CheckedContinuation<Void,Never>) in continuation=c;web.load(URLRequest(url:URL(string:"http://127.0.0.1:5179/fixtures/razors/index.html"+query)!)) }
  try await waitFor("document.querySelectorAll('.razor-card').length===3")
  _ = try await js("""
   window.qa={
    button:(text,root=document)=>[...root.querySelectorAll('button')].find(b=>b.textContent.trim()===text),
    click:(text,root=document)=>{const b=qa.button(text,root);if(!b)throw Error('Missing '+text);b.click();},
    fill:(selector,value)=>{const e=document.querySelector(selector);Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));},
    stock:()=>__razorFixture.snapshot().sources.reduce((n,s)=>n+s.quantity,0)
   }; void 0;
  """)
 }
 func screenshot(_ name:String) async throws {
  let image=try await web.takeSnapshot(configuration:nil)
  guard let tiff=image.tiffRepresentation,let bitmap=NSBitmapImageRep(data:tiff),let png=bitmap.representation(using:.png,properties:[:]) else {throw QAFailure(message:"Snapshot failed")}
  try png.write(to:URL(fileURLWithPath:output+"/"+name+".png"))
 }
 func layout(_ name:String) async throws {
  try await check("return document.documentElement.scrollWidth<=innerWidth+1",name+": no horizontal overflow")
  try await check("return [...document.querySelectorAll('.razor-panel button,.razor-panel input,.razor-panel select')].filter(e=>e.getClientRects().length).every(e=>e.getBoundingClientRect().height>=43)",name+": controls >=44 CSS pixels")
  try await check("return window.__qaErrors.length===0",name+": no browser errors")
 }
 func openChange() async throws {
  _ = try await js("qa.click('Change Blade',document.querySelector('.razor-card'))")
  try await waitFor("document.querySelector('form[aria-label=\"Record blade replacement\"]')")
 }
 func run() async throws {
  for (width,height) in [(320,740),(390,844),(768,1024)] {
   for view in ["home","form"] {
    try await load("?view="+view,width,height)
    try await layout("\(view) \(width) initial")
    try await check("return document.body.textContent.includes('Last change unknown') && document.body.textContent.includes('Reminders off') && document.body.textContent.includes('Blade replacement overdue')",view+": exact unknown/off/opt-in reminder states")
    try await screenshot("\(view)-\(width)-initial")
    try await openChange()
    try await check("return document.querySelector('form select').value==='' && qa.button('Confirm replacement').disabled",view+": explicit source required")
    _ = try await js("document.querySelector('form').scrollIntoView({block:'start'})")
    try await layout("\(view) \(width) confirmation")
    try await screenshot("\(view)-\(width)-confirm")
    _ = try await js("qa.click('Cancel')")
    try await waitFor("!document.querySelector('form')")
    try await check("return __razorFixture.writes.length===0 && qa.stock()===5",view+": cancel does not mutate")
    if view=="form" {try await check("return !qa.button('Configure') && !qa.button('Add razor')","FORM does not expose inventory configuration")}
   }
  }
  // Cancel configuration after editing without consuming inventory or inventing history.
  try await load()
  _ = try await js("qa.click('Add razor')")
  try await waitFor("document.querySelector('form[aria-label=\"Configure razor\"]')")
  try await check("return document.querySelector('form select').value==='' && [...document.querySelectorAll('form input[type=number]')].every(e=>e.value==='')","new configuration has no guessed stock/cadence/reminder")
  _ = try await js("qa.fill('form input','Do not save');qa.click('Cancel')")
  try await waitFor("!document.querySelector('form')")
  try await check("return __razorFixture.writes.length===0 && __razorFixture.snapshot().history.length===2","configuration cancel leaves exact history")
  // Rapid repeated clicks while the fixture is deliberately slow.
  try await openChange();_ = try await js("qa.fill('form select','drawer')")
  _ = try await js("const b=qa.button('Confirm replacement');b.click();b.click();document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))")
  try await waitFor("!document.querySelector('form')")
  try await check("return __razorFixture.writes.length===1 && qa.stock()===4 && __razorFixture.snapshot().history.length===3","rapid repeated clicks consume once")
  // A failure before commit, lost response after commit, and refresh failure after commit.
  for fault in ["before","after","refresh"] {
   try await load("?view=form&fault="+fault,320,740);try await openChange()
   _ = try await js("qa.fill('form select','drawer');qa.click('Confirm replacement')")
   try await waitFor("document.querySelector('[role=alert]') && !qa.button('Retry same save').disabled")
   try await check("return document.querySelector('fieldset').disabled && __razorFixture.writes.length===1","\(fault): failed operation remains frozen")
   try await check("return qa.stock()===\(fault=="before" ? 5 : 4)","\(fault): stock reflects only committed work")
   _ = try await js("document.querySelector('form').scrollIntoView({block:'start'})")
   try await check("const r=document.querySelector('[role=alert]').getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight","\(fault): failure message visible beside active form")
   try await layout("\(fault) 320 failure");try await screenshot("form-320-"+fault)
   if fault=="refresh" {
    _ = try await js("qa.click('Reload and review history')")
    try await waitFor("!document.querySelector('form')")
    try await check("return __razorFixture.writes.length===1 && qa.stock()===4","refresh failure recovery does not resend mutation")
   } else {
    _ = try await js("qa.click('Retry same save')")
    try await waitFor("!document.querySelector('form')")
    try await check("return __razorFixture.writes.length===2 && JSON.stringify(__razorFixture.writes[0])===JSON.stringify(__razorFixture.writes[1]) && qa.stock()===4 && __razorFixture.snapshot().history.length===3","\(fault): retry reuses exact request and consumes once")
   }
  }
  try await load("?view=form",320,740)
  _ = try await js("qa.click('Change Blade',document.querySelectorAll('.razor-card')[2])")
  try await waitFor("document.querySelector('form')")
  try await check("return qa.button('Confirm replacement').disabled && document.body.textContent.includes('No blades available') && __razorFixture.writes.length===0","zero stock remains blocked")
  _ = try await js("document.querySelector('form').scrollIntoView({block:'start'})")
  try await layout("zero stock 320");try await screenshot("form-320-zero-stock")
 }
}
Task { @MainActor in let probe=Probe();probe.start() };app.run()
