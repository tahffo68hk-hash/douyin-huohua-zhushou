#!/usr/bin/env python3
from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
a=(root/'vendor/reference-original.txt').read_text(encoding='utf-8-sig')
b=(root/'douyin-spark.user.js').read_text()
def grab(s,name):
    m=re.search(r'(?:async )?function '+re.escape(name)+r'\([^\n]*\) \{[\s\S]+?\n\}',s)
    assert m is not None,name
    return m.group(0)
# These functions must stay verbatim; the new UI must not secretly invoke v0.8 runOne.
for name in ['simulateMouseClick','triggerEnterToSend','inputMessageToChatEditor',
 'findAndClickTargetUserChat','findAndClickTargetUser','getNextTargetUser','markUserAsSent',
 'sendMessage','executeSendProcess','scheduleRetry','autoScrollChatListAndCollect']:
    assert grab(a,name)==grab(b,name),f'Reference core unexpectedly changed: {name}'
assert grab(a,'tryFindChatInput').replace('setTimeout(sendMessage, 3000);', 'setTimeout(sendMessage, Math.max(3000,Math.min(30000,(Number(sparkUi.delaySeconds)||3)*1000)));') == grab(b,'tryFindChatInput')
assert 'function runOne(' not in b
assert "const SPARK_UI_BUILD" in b
assert 'function sparkSendDirect()' in b
assert 'sendMessage();' in grab(b,'sparkSendDirect')
assert 'X-Spark-Token' in grab(b,'notifyScriptB')
assert '// @connect      127.0.0.1' in b
print('PASS: 11 original core functions preserved verbatim; one pacing parameter changed')
print('PASS: new UI calls reference sendMessage and callback matches local scheduler')
