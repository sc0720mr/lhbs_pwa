// ===== 設定 =====
// localStorage 名稱
const BUS_AD_KEY = 'bus_ad_closed_time';

// 幾小時後再次顯示
const SHOW_AGAIN_HOURS = 24;

// ===== 關閉廣告 =====
function closeBusAd() {

    // 記錄關閉時間
    localStorage.setItem(
        BUS_AD_KEY,
        Date.now()
    );

    // 隱藏廣告
    document.getElementById('busAdOverlay').style.display = 'none';
}

// ===== 是否需要顯示廣告 =====
function shouldShowBusAd() {

    // 取得上次關閉時間
    const lastClosedTime = localStorage.getItem(BUS_AD_KEY);

    // 沒有紀錄 → 顯示
    if (!lastClosedTime) {
        return true;
    }

    // 目前時間
    const now = Date.now();

    // 相差毫秒
    const diff = now - Number(lastClosedTime);

    // 換算小時
    const diffHours = diff / (1000 * 60 * 60);

    // 超過設定時數 → 顯示
    return diffHours >= SHOW_AGAIN_HOURS;
}

// ===== 頁面載入 =====
window.addEventListener('load', () => {

    // 判斷是否顯示
    if (shouldShowBusAd()) {

        // 延遲跳出
        setTimeout(() => {

            document.getElementById('busAdOverlay').style.display = 'flex';

        }, 1500);

    }

});