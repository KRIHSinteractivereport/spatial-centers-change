/********************************************************************
 * region_control.js
 *
 * - 'sido_sgg_mapping_with_centroids.json'을 불러와
 *   시도 및 시군구 선택 박스를 동적으로 생성합니다.
 * - 'bf_2021.csv'와 'af_2023.csv'를 PapaParse로 파싱하여
 *   각 년도별 중심지 유형 통계(개수)를 계산합니다.
 * - "확인하기" 버튼 클릭 시, 선택된 지역(전국/시도/시군구)으로 지도 줌 및
 *   통계 테이블을 생성(updateTable)하고 이벤트 핸들러를 연결합니다.
 *
 * 1) 전역 변수 : bfData, afData, regionData
 * 2) populateSelectBoxes()   : 시도/시군구 드롭다운 생성
 * 3) countByType(dataArray)  : 유형별 개수 세기
 * 4) updateTable(mode, sido, sgg) : 통계 테이블 생성 및 이벤트 바인딩
 *
 ********************************************************************/
window.crossTabPending = null;

/* 전역 배열 초기화 */
let bfData = [];     // 2021년 데이터 (CSV 파싱 결과)
let afData = [];     // 2023년 데이터 (CSV 파싱 결과)
let regionData = []; // 시도/시군구 정보(JSON 파싱 결과)

/* 1) 시도/시군구 매핑 JSON 비동기 로드 */
fetch('sido_sgg_mapping_with_centroids.json')
  .then((response) => response.json())
  .then((data) => {
    regionData = data;
    populateSelectBoxes();
  })
  .catch((err) => {
    console.error('sido_sgg_mapping_with_centroids.json 로드 실패:', err);
  });

/**
 * populateSelectBoxes
 * - 시도 드롭다운을 '전체' 옵션 + JSON에서 가져온 시도 목록으로 채웁니다.
 * - 시도 선택 시에는 시군구 드롭다운을 '전체' 옵션 + 해당 시도의 시군구 목록으로 갱신합니다.
 */
function populateSelectBoxes() {
  const sidoSelect = document.getElementById('sidoSelect');
  const sggSelect = document.getElementById('sggSelect');

  // 초기화
  sidoSelect.innerHTML = '';
  sggSelect.innerHTML = '';

  // 1) 시도 선택 박스에 '전체' 옵션 추가
  const allSidoOption = document.createElement('option');
  allSidoOption.value = 'all';
  allSidoOption.textContent = '전체';
  sidoSelect.appendChild(allSidoOption);

  // 2) JSON에서 고유 시도명 추출 후 옵션 생성
  const sidoList = [...new Set(regionData.map((d) => d.SIDO_NM))];
  sidoList.forEach((sido) => {
    const option = document.createElement('option');
    option.value = sido;
    option.textContent = sido;
    sidoSelect.appendChild(option);
  });

  // 3) 시도 선택 변경 시, 시군구 드롭다운 갱신
  sidoSelect.addEventListener('change', function () {
    const selectedSido = this.value;
    sggSelect.innerHTML = '';

    // 기본: '전체' 시군구 옵션 추가
    const allSggOption = document.createElement('option');
    allSggOption.value = 'all';
    allSggOption.textContent = '전체';
    sggSelect.appendChild(allSggOption);

    // 실제 시도 선택 시, 해당 시도의 시군구 옵션만 추가
    if (selectedSido !== 'all') {
      const filteredSggs = regionData.filter((d) => d.SIDO_NM === selectedSido);
      filteredSggs.forEach((entry) => {
        const option = document.createElement('option');
        option.value = entry.SGG_NM;
        option.textContent = entry.SGG_NM;
        sggSelect.appendChild(option);
      });
    }
  });
}

/* 2) CSV 파일 비동기 로드 및 파싱 (PapaParse) */
const start = performance.now();
Promise.all([
  fetch('./bf_2021.csv').then((r) => r.text()),
  fetch('./af_2023.csv').then((r) => r.text())
])
  .then(([bfText, afText]) => {
    const mid = performance.now();
    console.log(`📥 Fetch + Read Time: ${(mid - start).toFixed(2)} ms`);

    // PapaParse로 CSV 파싱 (header 포함, 빈 줄 건너뜀)
    bfData = Papa.parse(bfText, {
      header: true,
      skipEmptyLines: true
    }).data;

    afData = Papa.parse(afText, {
      header: true,
      skipEmptyLines: true
    }).data;

    const end = performance.now();
    console.log(`총 로딩 시간: ${(end - start).toFixed(2)} ms`);
  })
  .catch((err) => {
    console.error('CSV 로드 실패:', err);
  });

/**
 * countByType
 * 주어진 dataArray 내의 'type' 컬럼 값을 키로 사용하여,
 * 각 유형별 개수를 객체 형태로 리턴합니다.
 *
 * @param {Array<Object>} dataArray - CSV 파싱 배열 (각 행: { ..., type: '...', ... })
 * @returns {Object} - { '중심지 I': 10, '중심지 II': 5, ... }
 */
function countByType(dataArray) {
  const counts = {};
  dataArray.forEach((d) => {
    const key = d.type;
    if (key in counts) {
      counts[key]++;
    } else {
      counts[key] = 1;
    }
  });
  return counts;
}

/**
 * updateTable
 * - mode 값에 따라 (national / sido / sgg) CSV 데이터를 필터링하고,
 *   중심지 유형별 개수를 비교한 HTML 테이블을 생성하여 #resultTable에 삽입합니다.
 * - 테이블의 각 셀(증감)을 클릭하거나, 체크박스를 토글하면
 *   highlightChangedGridsByType 함수가 호출되어 지도 위에 강조 레이어가 나타납니다.
 *
 * @param {string} mode       - 'national' | 'sido' | 'sgg'
 * @param {string|null} sidoName - 필터링할 시도명 (mode === 'sido' or 'sgg')
 * @param {string|null} sggName  - 필터링할 시군구명 (mode === 'sgg')
 */
function updateTable(mode, sidoName = null, sggName = null) {
  let filteredBf = [];
  let filteredAf = [];

  // 1) 필터링 로직
  if (mode === 'national') {
    // 전국 전체 데이터
    filteredBf = bfData;
    filteredAf = afData;
  } else if (mode === 'sido' && sidoName) {
    // 특정 시도 데이터
    filteredBf = bfData.filter((d) => d.SIDO_NM === sidoName);
    filteredAf = afData.filter((d) => d.SIDO_NM === sidoName);
  } else if (
    mode === 'sgg' &&
    sidoName &&
    sggName &&
    sggName !== 'all'
  ) {
    // 특정 시도+시군구 데이터
    filteredBf = bfData.filter(
      (d) => d.SIDO_NM === sidoName && d.SGG_NM === sggName
    );
    filteredAf = afData.filter(
      (d) => d.SIDO_NM === sidoName && d.SGG_NM === sggName
    );
  }

  // 2) 유형별 개수 계산
  const bfCounts = countByType(filteredBf);
  const afCounts = countByType(filteredAf);

  // 3) 2021/2023 모두 등장하는 모든 유형을 합쳐서 오름차순 정렬
  const allTypes = [
    ...new Set([...Object.keys(bfCounts), ...Object.keys(afCounts)])
  ].sort();

  // 4) HTML 테이블 문자열 생성 시작
  let html = `
    <table class = "main-table">
      <thead>
        <tr>
          <th>중심지 유형</th>
          <th>2021년</th>
          <th>2023년</th>
          <th id="diffHeader" style="text-align: center;">
            <label style="display: flex; align-items: center; justify-content: center; gap: 4px;">
              <span>절대 변화량</span>
              <input type="checkbox" id="toggleAllDiff" />
            </label>
          </th>
        </tr>
      </thead>
      <tbody>
  `;

  // 5) 각 유형별로 행 추가
  allTypes.forEach((type) => {
    const bfVal = bfCounts[type] || 0;
    const afVal = afCounts[type] || 0;
    const diff = afVal - bfVal;
    const diffStr = diff > 0 ? `+${diff}` : diff.toString();

    html += `
      <tr>
        <td>${type}</td>
        <td>${bfVal}</td>
        <td>${afVal}</td>
        <td class="diff-cell" data-type="${type}">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span>${diffStr}</span>
            <input type="checkbox" class="toggle-type" data-type="${type}" />
          </div>
        </td>
      </tr>
    `;
  });

  html += '</tbody></table>';

  // 6) #resultTable 영역에 삽입
  const tableContainer = document.getElementById('base');
  tableContainer.innerHTML = html;

  // 7) 각 '증감' 셀 클릭 시 → highlightChangedGridsByType 호출
  document.querySelectorAll('.diff-cell').forEach((cell) => {
    cell.addEventListener('click', () => {
      const clickedType = cell.dataset.type;
      const sido = document.getElementById('sidoSelect').value;
      const sgg = document.getElementById('sggSelect').value;

      console.log(
        `[클릭됨] 증감 유형: ${clickedType}, 시도: ${sido}, 시군구: ${sgg}`
      );
      if (!window.changeMap) {
        console.warn('⚠️ changeMap 데이터가 아직 로드되지 않았습니다.');
      }
      highlightChangedGridsByType(clickedType, sido, sgg);
    });
  });

  // 8) 체크박스 토글 시 → 해당 유형 레이어 켜기/끄기
  document.querySelectorAll('.toggle-type').forEach((checkbox) => {
    checkbox.addEventListener('change', (e) => {
      const type = e.target.dataset.type;
      const checked = e.target.checked;
      const sido = document.getElementById('sidoSelect').value;
      const sgg = document.getElementById('sggSelect').value;

      if (checked) {
        // 체크하면 해당 유형 강조
        highlightChangedGridsByType(type, sido, sgg);
      } else {
        // 체크 해제하면 해당 유형 레이어만 제거
        if (
          window.typeHighlightLayers &&
          window.typeHighlightLayers[type]
        ) {
          map.removeLayer(window.typeHighlightLayers[type]);
          delete window.typeHighlightLayers[type];
        }
      }
    });
  });

  // 9) '증감' 헤더 클릭 시 → 전체 변화 격자 강조
  document
    .getElementById('diffHeader')
    ?.addEventListener('click', () => {
      const sido = document.getElementById('sidoSelect').value;
      const sgg = document.getElementById('sggSelect').value;
      highlightAllChangedGrids(sido, sgg);
    });

  // 10) '증감' 전체 체크박스 토글 시 → 전체 강조 켜기/끄기
  document
    .getElementById('toggleAllDiff')
    ?.addEventListener('change', (e) => {
      const checked = e.target.checked;
      const sido = document.getElementById('sidoSelect').value;
      const sgg = document.getElementById('sggSelect').value;

      if (checked) {
        highlightAllChangedGrids(sido, sgg);
      } else {
        if (window.totalDiffHighlightLayer) {
          map.removeLayer(window.totalDiffHighlightLayer);
          delete window.totalDiffHighlightLayer;
        }
      }
    });
}

/**
 * updateCrossTab
 * - 크로스탭(행=2021 유형, 열=2023 유형, 각 교차 셀=전환 개수, 마지막 열=절대 변화량) 생성
 * - sidoName, sggName을 받아 해당 지역에 해당하는 GeoJSON 피처만 필터링하여 표를 만듭니다.
 */

function updateCrossTab(sidoName, sggName) {
  // 1) changeMap 로드 여부 확인
  if (!window.changeMap || !window.changeMap.features) {
    console.warn('❗ changeMap 데이터가 준비되지 않았습니다.');
    // 크로스탭 영역을 비웁니다
    document.getElementById('expanded').innerHTML = '';
    return;
  }

    // 2) 지역 필터링 (전국 / 시도 / 시군구)
    const filteredFeatures = window.changeMap.features.filter((f) => {
        const p = f.properties;
        if (sidoName === 'all') {
        return true;
        } else if (sggName === 'all') {
        return p.SIDO_NM === sidoName;
        } else {
        return p.SIDO_NM === sidoName && p.SGG_NM === sggName;
        }
    });

    // 3) 2021, 2023 유형 집합 추출
    const set2021 = new Set();
    const set2023 = new Set();
    filteredFeatures.forEach((f) => {
        const p = f.properties;
        if (p.type_2021) set2021.add(p.type_2021);
        if (p.type_2023) set2023.add(p.type_2023);
    });
    const all2021 = Array.from(set2021).sort();
    const all2023 = Array.from(set2023).sort();

    // 4) 전환 매트릭스(matrix) 초기화 [all2021.length x all2023.length]
    const nRows = all2021.length;
    const nCols = all2023.length;
    const matrix = [];
    for (let i = 0; i < nRows; i++) {
        matrix.push(new Array(nCols).fill(0));
    }

    // 5) 각 피처별로 matrix[rIdx][cIdx] 누적
    filteredFeatures.forEach((f) => {
        const p = f.properties;
        const rIdx = all2021.indexOf(p.type_2021);
        const cIdx = all2023.indexOf(p.type_2023);
        if (rIdx >= 0 && cIdx >= 0) {
        matrix[rIdx][cIdx] += 1;
        }
    });

    // 6) HTML 테이블 생성 시작
    let html = `
    <table class="crossTab-table">
        <thead>
        <tr>
            <!-- SVG 기반 대각선 헤더 셀 (인라인 스타일 제거) -->
            <th class="diag-header">
            <!-- SVG: 대각선이 셀 전체를 덮도록 preserveAspectRatio="none" 설정 -->
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" preserveAspectRatio="none">
                <line x1="0" y1="0" x2="100" y2="50" stroke="#ddd" stroke-width="1" />
            </svg>
            <div class="diag-text-top">2023년</div>
            <div class="diag-text-bottom">2021년</div>
            </th>
    `;

    // 6-1) 2023년 유형들을 열(header)로 추가 (인라인 스타일 제거)
    all2023.forEach((type2023) => {
    html += `<th>${type2023}</th>`;
    });

    html += `
        </tr>
        </thead>
        <tbody>
    `;

    // 6-2) 각 2021년 유형별 행(row) 추가
    all2021.forEach((type2021, rIdx) => {
    html += `<tr>`;

    // 행 첫 번째 셀: 2021년 유형 이름 (인라인 스타일 제거)
    html += `<td>${type2021}</td>`;

    // 6-3) 2021 → 2023 전환 개수를 교차 셀에 집어넣기 (인라인 스타일 제거, 중앙 정렬은 CSS에서 처리)
    for (let c = 0; c < nCols; c++) {
        const cnt = matrix[rIdx][c];
        html += `<td>${cnt}</td>`;
    }

    html += `</tr>`;
    });

    html += `
        </tbody>
    </table>
    `;

    // 7) 화면에 삽입
    document.getElementById('expanded').innerHTML = html;
    }




/* ============================
   '확인하기' 버튼 클릭 시 이벤트
   - CSV 데이터 로딩 여부 확인
   - 선택된 지역 값(sido, sgg)에 따라 지도 이동
   - updateTable 호출
   ============================ */
document.getElementById('searchBtn').addEventListener('click', function () {
  // (1) CSV 데이터 로딩 여부 확인
  if (bfData.length === 0 || afData.length === 0) {
    alert('데이터를 아직 불러오는 중입니다. 잠시 후 다시 시도해주세요.');
    return;
  }

  // (2) 선택된 시도/시군구 값 읽기
  const sido = document.getElementById('sidoSelect').value;
  const sgg  = document.getElementById('sggSelect').value;

  // (3) 전국/시도/시군구 분기
  if (sido === 'all') {
    map.setView([37.5665, 126.9780], 7);
    updateTable('national');
    updateCrossTab('all', 'all');       // ← 이 라인을 추가하세요!
  } else if (sgg === 'all') {
    const targetSido = regionData.find((d) => d.SIDO_NM === sido);
    if (targetSido) {
      map.setView([targetSido.lat_sido, targetSido.lon_sido], 10);
      updateTable('sido', sido);
      updateCrossTab(sido, 'all');      // ← 이 라인을 추가하세요!
    }
  } else {
    const targetSgg = regionData.find(
      (d) => d.SIDO_NM === sido && d.SGG_NM === sgg
    );
    if (targetSgg) {
      map.setView([targetSgg.lat_sgg, targetSgg.lon_sgg], 12);
      updateTable('sgg', sido, sgg);
      updateCrossTab(sido, sgg);        // ← 이 라인을 추가하세요!
    } else {
      alert('선택한 지역 정보를 찾을 수 없습니다.');
    }
  }

// 여기부터!
  const runCrossTab = () => {
    if (sido === 'all') updateCrossTab('all', 'all');
    else if (sgg === 'all') updateCrossTab(sido, 'all');
    else updateCrossTab(sido, sgg);
  };

  if (window.changeMap && window.changeMap.features) {
    runCrossTab(); // 데이터 준비됐으면 즉시 실행
  } else {
    // 데이터 준비 전이면 "대기"만 시켜둠
    window.crossTabPending = runCrossTab;
    // 원한다면 여기에 안내 메시지(로딩 중) 넣어도 됨
  }

});