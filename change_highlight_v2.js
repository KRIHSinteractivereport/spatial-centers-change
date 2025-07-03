/********************************************************************
 * change_highlight.js
 *
 * - GeoJSON('type_change_map.geojson')을 불러와서,
 *   특정 중심지 유형의 변화 격자를 지도 위에 강조(하이라이트)합니다.
 * - 개별 유형 강조 (highlightChangedGridsByType) 및
 *   전체 변경 격자 강조 (highlightAllChangedGrids) 기능 제공.
 *
 * 1) 전역 변수
 *    - window.changeMap           : 로드된 GeoJSON 객체
 *    - window.typeHighlightLayers : 유형별 L.geoJSON 레이어 저장소
 *    - window.totalDiffHighlightLayer : 전체 변화 격자 레이어
 *
 * 2) 주요 함수
 *    - highlightChangedGridsByType(type, sido, sgg)
 *    - highlightAllChangedGrids(sido, sgg)
 *    - blinkLayer(layer, times, finalOpacity, delay)
 *
 ********************************************************************/

/* 전역 저장소 초기화 */
window.changeMap = null;          // GeoJSON 데이터 (type_change_map.geojson)
window.typeHighlightLayers = {};  // '유형별 레이어'를 key:type, value:L.geoJSON

/* 1) GeoJSON 파일 비동기 로드 → window.changeMap 설정 */
fetch('type_change_map.geojson')
  .then((res) => res.json())
  .then((data) => {
    window.changeMap = data;
    if (window.crossTabPending) {
      window.crossTabPending();
      window.crossTabPending = null;
    }
  })
  .catch((err) => {
    console.error('type_change_map.geojson 로드 실패:', err);
  });

/**
 * highlightChangedGridsByType
 * 특정 중심지 유형(type)에 해당하는 변화 격자만 필터링하여 강조
 *
 * @param {string} type  - 강조할 중심지 유형 (예: '중심지 I')
 * @param {string} sido  - '시도' 필터 (all | 실제 시도명)
 * @param {string} sgg   - '시군구' 필터 (all | 실제 시군구명)
 */
window.highlightChangedGridsByType = function(type, sido, sgg) {
  // GeoJSON 로드 여부 확인
  if (!window.changeMap) {
    console.warn('변화맵(GeoJSON)이 아직 로딩되지 않았습니다.');
    return;
  }

  // 1) GeoJSON features 필터링 조건:
  //    - type_changed가 true (변화가 발생한 격자)
  //    - 이전(2021) 또는 이후(2023) 유형 중 하나가 'type'과 일치
  //    - '시도/시군구' 지역 필터 조건 만족
  const filtered = {
    type: "FeatureCollection",
    features: window.changeMap.features.filter((f) => {
      const p = f.properties;
      // 유형 일치 여부
      const typeMatch = p.type_changed && (p.type_2021 === type || p.type_2023 === type);

      // 지역 필터 (전국 / 시도 / 시군구)
      const regionMatch =
        sido === 'all' ||
        (sgg === 'all' && p.SIDO_NM === sido) ||
        (p.SIDO_NM === sido && p.SGG_NM === sgg);

      return typeMatch && regionMatch;
    })
  };

  // 2) 기존에 같은 'type'으로 생성된 레이어가 있으면 제거
  if (window.typeHighlightLayers[type]) {
    map.removeLayer(window.typeHighlightLayers[type]);
    delete window.typeHighlightLayers[type];
  }

  // 3) 필터링 결과가 없으면 로그만 출력 후 종료
  if (filtered.features.length === 0) {
    console.log('해당 조건에 부합하는 변화 격자가 없습니다.');
    return;
  }

  // 4) 새로운 L.geoJSON 레이어 생성 (스타일 + 툴팁 추가)
  const layer = L.geoJSON(filtered, {
    style: {
      color: '#ffff00',      // 외곽선: 노란색
      weight: 1.5,
      fillColor: '#ffff00',  // 내부 채우기: 노란색 (단, 초기 fillOpacity 0)
      fillOpacity: 0,
      opacity: 1,
      dashArray: null,
      className: 'glow-effect'  // CSS glow 효과
    },
    onEachFeature: (feature, layer) => {
      const p = feature.properties;
      const tooltipContent = `
        <b>중심지 변화</b><br>
        <span style="color: #999;">
          ${p.type_2021 || '없음'} → ${p.type_2023 || '없음'}
        </span>
      `;
      layer.bindTooltip(tooltipContent, {
        sticky: true,
        direction: 'top',
        offset: [0, -8]
      });
    }
  }).addTo(map);

  // 5) 전역 저장소에 새로운 레이어를 보관
  window.typeHighlightLayers[type] = layer;

  // 6) 깜빡임 애니메이션: fillOpacity를 번갈아 바꾸며 눈에 띄게 함
  blinkLayer(layer, 4, 0, 400);
  //   → delay 400ms 후 시작, 총 2회 깜빡이고 finalOpacity=0

  // 7) 강조된 레이어 범위에 맞추어 지도 이동
  const bounds = layer.getBounds();
  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();
  const latDiff = Math.abs(ne.lat - sw.lat);
  const lngDiff = Math.abs(ne.lng - sw.lng);

  // 범위가 넓으면 fitBounds, 좁으면 panTo
  if (latDiff > 0.3 || lngDiff > 0.3) {
    map.fitBounds(bounds);
  } else {
    map.panTo(bounds.getCenter());
  }
};

/**
 * highlightAllChangedGrids
 * 선택된 시도·시군구 기준으로
 * 'type_changed === true'인 모든 격자(전체 변화)를 강조
 *
 * @param {string} sido - '시도' 필터 (all | 실제 시도명)
 * @param {string} sgg  - '시군구' 필터 (all | 실제 시군구명)
 */
window.highlightAllChangedGrids = function(sido, sgg) {
  if (!window.changeMap) {
    console.warn('변화맵(GeoJSON)이 아직 로딩되지 않았습니다.');
    return;
  }

  // 1) 전체 변화 격자 필터링 (type_changed === true + 지역 필터)
  const filtered = {
    type: "FeatureCollection",
    features: window.changeMap.features.filter((f) => {
      const p = f.properties;
      const regionOk =
        sido === 'all' ||
        (sgg === 'all' && p.SIDO_NM === sido) ||
        (p.SIDO_NM === sido && p.SGG_NM === sgg);
      return p.type_changed && regionOk;
    })
  };

  // 2) 기존에 전체 변화 레이어가 있으면 제거
  if (window.totalDiffHighlightLayer) {
    map.removeLayer(window.totalDiffHighlightLayer);
    delete window.totalDiffHighlightLayer;
  }

  // 3) 필터링 결과가 없으면 종료
  if (filtered.features.length === 0) {
    console.log('전체 변화 격자가 없습니다.');
    return;
  }

  // 4) 새로운 L.geoJSON 레이어 생성 (스타일 + 툴팁)
  const layer = L.geoJSON(filtered, {
    style: {
      color: '#ffff00',
      weight: 1.5,
      fillColor: '#ffff00',
      fillOpacity: 0,
      opacity: 1,
      dashArray: null,
      className: 'glow-effect'
    },
    onEachFeature: (feature, layer) => {
      const p = feature.properties;
      const tooltipContent = `
        <b>중심지 변화</b><br>
        ${p.type_2021 || '없음'} → ${p.type_2023 || '없음'}
      `;
      layer.bindTooltip(tooltipContent, {
        sticky: true,
        direction: 'top',
        offset: [0, -8]
      });
    }
  }).addTo(map);

  // 5) 최상단으로 올려놓기
  layer.bringToFront();

  // 6) 전역 저장소에 보관
  window.totalDiffHighlightLayer = layer;
};

/**
 * blinkLayer
 * 주어진 레이어를 일정 시간 동안 깜빡이는 애니메이션 처리
 *
 * @param {L.Layer} layer        - 깜빡일 L.geoJSON 레이어
 * @param {number} times         - 깜빡임 반복 횟수
 * @param {number} finalOpacity  - 최종 남길 fillOpacity 값 (0 ~ 1)
 * @param {number} delay         - 시작 전 대기 시간(ms)
 */
function blinkLayer(layer, times = 2, finalOpacity = 0.3, delay = 400) {
  let count = 0;

  // delay 후 깜빡임 시작
  setTimeout(() => {
    const interval = setInterval(() => {
      // 짝수일 때와 홀수일 때 opacity를 번갈아 설정
      const opacity = count % 2 === 0 ? 0.05 : 0.6;
      layer.setStyle({ fillOpacity: opacity });
      count++;

      // 지정 횟수만큼 깜빡이면 종료하고 finalOpacity로 설정
      if (count >= times * 2) {
        clearInterval(interval);
        layer.setStyle({ fillOpacity: finalOpacity });
      }
    }, 300);
  }, delay);
}
