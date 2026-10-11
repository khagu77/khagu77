// 숨겨진 탭에서는 크롬이 setTimeout 을 크게 늦춘다(최대 1분 단위). 워커의 타이머는 그렇지 않아 대기 시간을 여기서 잰다.
onmessage = (e) => setTimeout(() => postMessage(e.data.id), e.data.ms);
