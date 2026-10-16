"""스크립트 기본 교정(youtube-extension/correct.js) 규칙 테스트 - node 로 실행한다."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

CORRECT_JS = Path(__file__).resolve().parent.parent / "youtube-extension" / "correct.js"

CASES = [
    ("어제  됬어요 몇일 걸렸는데", "어제 됐어요 며칠 걸렸는데"),
    ("이거 할수있다 그런것같아요", "이거 할 수 있다 그런 것 같아요"),
    ("내일 할께요 갈때 연락할거예요", "내일 할게요 갈 때 연락할 거예요"),
    ("그것때문에 안되요", "그것 때문에 안돼요"),
    ("좋아요 , 그런데 (  정말 )?진짜", "좋아요, 그런데 (정말)? 진짜"),
    ("수있어요 끝.다음", "수 있어요 끝. 다음"),
    ("금새 끝났고 왠만하면 일일히 확인", "금세 끝났고 웬만하면 일일이 확인"),
    # 고치면 안 되는 것
    ("수없이 많은 별것 아무것 들것 이것 모든것이", "수없이 많은 별것 아무것 들것 이것 모든 것이"),
    ("1.5배 속도 3,000원 ...음", "1.5배 속도 3,000원 ...음"),
    ("선생님께서 오셨다", "선생님께서 오셨다"),
    ("갈수록 좋아지네요", "갈수록 좋아지네요"),
    ("안녕하세요 반갑습니다", "안녕하세요 반갑습니다"),
]


@pytest.mark.skipif(not shutil.which("node"), reason="node 없음")
def test_correct_rules():
    script = (
        f"const {{correctText}} = require({json.dumps(str(CORRECT_JS))});"
        f"console.log(JSON.stringify({json.dumps([c[0] for c in CASES], ensure_ascii=False)}.map(s => correctText(s).text)));"
    )
    out = json.loads(subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True).stdout)
    assert out == [c[1] for c in CASES]
