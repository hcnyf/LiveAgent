//! 启动时的窗口几何：把 window-state 插件还原出来的坐标钳回"确实可见"的区域。
//!
//! 插件自身只保证还原坐标与某个显示器**有交集**（1px 也算），拔掉外接屏后仍可能
//! 还原出一个几乎完全在屏外的窗口（原 `WINDOW_STATE_FLAGS` 注释警告的正是这条回归）。
//! 这里按"两轴重叠 ≥ 80×80px"收紧：不满足就回主显示器居中；一个显示器都拿不到
//! （全部拔空）时不下发坐标，交给系统摆放。
//!
//! 纯几何与 tauri 适配分层：几何部分不依赖窗口句柄，单测直接锁住。

use tauri::WebviewWindow;

/// 窗口至少要有这么多像素落在某个显示器工作区内，才算"用户能看见"。
pub const MIN_VISIBLE_PX: i32 = 80;

/// 屏幕坐标下的矩形（物理像素，原点随显示器布局）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl Rect {
    fn right(&self) -> i32 {
        self.x.saturating_add(self.width)
    }

    fn bottom(&self) -> i32 {
        self.y.saturating_add(self.height)
    }
}

/// 两矩形的重叠尺寸；不相交时为 0（不出现负数）。
pub fn overlap_size(window: Rect, monitor: Rect) -> (i32, i32) {
    let width = window.right().min(monitor.right()) - window.x.max(monitor.x);
    let height = window.bottom().min(monitor.bottom()) - window.y.max(monitor.y);
    (width.max(0), height.max(0))
}

fn overlaps_enough(window: Rect, monitor: Rect) -> bool {
    let (width, height) = overlap_size(window, monitor);
    width >= MIN_VISIBLE_PX && height >= MIN_VISIBLE_PX
}

/// 还原坐标是否可用：任一显示器上的可见面积都够大即保留。
pub fn is_position_visible(window: Rect, monitors: &[Rect]) -> bool {
    monitors.iter().any(|monitor| overlaps_enough(window, *monitor))
}

/// 主显示器居中后的左上角；窗口比显示器还大时退回显示器原点（不产生负偏移）。
pub fn centered_position(window: Rect, monitor: Rect) -> (i32, i32) {
    (
        monitor.x + (monitor.width - window.width).max(0) / 2,
        monitor.y + (monitor.height - window.height).max(0) / 2,
    )
}

/// 钳制后的目标坐标：可见 → `None`（不动）；不可见 → 主显示器居中；
/// 一个显示器都拿不到 → `None`（交给系统摆放）。
pub fn clamp_target(window: Rect, monitors: &[Rect], primary: Option<Rect>) -> Option<(i32, i32)> {
    if monitors.is_empty() {
        return None;
    }
    if is_position_visible(window, monitors) {
        return None;
    }
    primary.map(|monitor| centered_position(window, monitor))
}

fn monitor_work_area(monitor: &tauri::Monitor) -> Rect {
    let work_area = monitor.work_area();
    Rect {
        x: work_area.position.x,
        y: work_area.position.y,
        width: work_area.size.width as i32,
        height: work_area.size.height as i32,
    }
}

/// 适配层：读当前窗口矩形与显示器工作区，必要时把窗口移回可见区域。
pub fn clamp_window_to_visible_monitor(window: &WebviewWindow) -> tauri::Result<()> {
    // 最大化/全屏由系统摆放，改坐标既无意义也会和还原出来的 prev_* 打架。
    if window.is_maximized().unwrap_or(false) || window.is_fullscreen().unwrap_or(false) {
        return Ok(());
    }
    let Ok(position) = window.outer_position() else {
        return Ok(());
    };
    let size = window.outer_size()?;
    let current = Rect {
        x: position.x,
        y: position.y,
        width: size.width as i32,
        height: size.height as i32,
    };
    let monitors: Vec<Rect> = window
        .available_monitors()?
        .iter()
        .map(monitor_work_area)
        .collect();
    let primary = window.primary_monitor()?.map(|monitor| monitor_work_area(&monitor));
    // 先处理「整块跑到屏幕外」（重定位到主屏中央），再把底边/右边收回工作区内。
    let target =
        clamp_target(current, &monitors, primary).or_else(|| clamp_into_work_area(current, &monitors));
    if let Some((x, y)) = target {
        window.set_position(tauri::PhysicalPosition::new(x, y))?;
    }
    Ok(())
}

/// 与某块矩形的重叠面积（无重叠为 0）。
fn overlap_area(left: Rect, right: Rect) -> i64 {
    let width = (left.x + left.width).min(right.x + right.width) - left.x.max(right.x);
    let height = (left.y + left.height).min(right.y + right.height) - left.y.max(right.y);
    if width <= 0 || height <= 0 {
        return 0;
    }
    i64::from(width) * i64::from(height)
}

/// 把窗口收进「与它重叠最多的那块工作区」。
///
/// 工作区（`rcWork`）已经排除任务栏。窗口底边越过它时，DWM 给窗口画的投影就会落在
/// 任务栏上——任务栏是亚克力材质，压在上面的投影最显眼，用户报的「靠近底部时任务栏
/// 被降低亮度」就是它。收边比让窗口整块消失温和：不动左上角，感知只是「被往上/
/// 往左挪了几像素」。窗口比工作区还大时以左上角为准，不做无意义的负偏移。
fn clamp_into_work_area(window: Rect, monitors: &[Rect]) -> Option<(i32, i32)> {
    let best = monitors
        .iter()
        .max_by_key(|monitor| overlap_area(window, **monitor))?;
    if overlap_area(window, *best) == 0 {
        return None;
    }
    let mut x = window.x;
    let mut y = window.y;
    let max_right = best.x + best.width;
    let max_bottom = best.y + best.height;
    if x + window.width > max_right {
        x = max_right - window.width;
    }
    if y + window.height > max_bottom {
        y = max_bottom - window.height;
    }
    x = x.max(best.x);
    y = y.max(best.y);
    (x != window.x || y != window.y).then_some((x, y))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pulls_a_window_off_the_taskbar() {
        // 工作区 1920x1040（底部 40px 是任务栏），窗口底边伸到 1100。
        let monitor = Rect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1040,
        };
        let straddling = Rect {
            x: 100,
            y: 700,
            width: 800,
            height: 400,
        };
        assert_eq!(clamp_into_work_area(straddling, &[monitor]), Some((100, 640)));

        // 已经在工作区内：一个像素都不动。
        let inside = Rect {
            x: 100,
            y: 100,
            width: 800,
            height: 400,
        };
        assert_eq!(clamp_into_work_area(inside, &[monitor]), None);

        // 窗口比工作区还大：以左上角为准，不做无意义的负偏移。
        let taller = Rect {
            x: 0,
            y: 0,
            width: 1920,
            height: 2000,
        };
        assert_eq!(clamp_into_work_area(taller, &[monitor]), None);
    }

    fn rect(x: i32, y: i32, width: i32, height: i32) -> Rect {
        Rect {
            x,
            y,
            width,
            height,
        }
    }

    const PRIMARY: Rect = Rect {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
    };

    #[test]
    fn keeps_a_window_fully_inside_a_monitor() {
        let window = rect(400, 300, 800, 600);
        assert!(is_position_visible(window, &[PRIMARY]));
        assert_eq!(clamp_target(window, &[PRIMARY], Some(PRIMARY)), None);
    }

    #[test]
    fn keeps_a_window_that_straddles_two_monitors() {
        let secondary = rect(1920, 0, 1920, 1080);
        // 跨屏：两轴重叠都远超阈值 → 保留原坐标。
        let window = rect(1800, 200, 800, 600);
        assert!(is_position_visible(window, &[PRIMARY, secondary]));
        assert_eq!(clamp_target(window, &[PRIMARY, secondary], Some(PRIMARY)), None);
    }

    #[test]
    fn centers_a_window_that_only_peeks_into_the_edge() {
        // 只在主显示器右缘探出 40px（不足 80），右屏已拔掉 → 回主显示器居中。
        let peeking = rect(1880, 200, 40, 600);
        assert!(!is_position_visible(peeking, &[PRIMARY]));
        assert_eq!(clamp_target(peeking, &[PRIMARY], Some(PRIMARY)), Some((940, 240)));
    }

    #[test]
    fn centers_a_window_that_landed_on_a_removed_monitor() {
        // 坐标来自已拔掉的右屏（x 远超主显示器宽度）。
        let window = rect(2400, 200, 800, 600);
        assert!(!is_position_visible(window, &[PRIMARY]));
        assert_eq!(
            clamp_target(window, &[PRIMARY], Some(PRIMARY)),
            Some(((1920 - 800) / 2, (1080 - 600) / 2))
        );
    }

    #[test]
    fn falls_back_to_the_system_when_no_monitor_is_reported() {
        let window = rect(2400, 200, 800, 600);
        assert_eq!(clamp_target(window, &[], Some(PRIMARY)), None);
        assert_eq!(clamp_target(window, &[], None), None);
    }

    #[test]
    fn leaves_the_position_untouched_when_the_primary_monitor_is_unknown() {
        let window = rect(2400, 200, 800, 600);
        assert_eq!(clamp_target(window, &[PRIMARY], None), None);
    }

    #[test]
    fn centers_a_window_larger_than_its_monitor_at_the_origin() {
        let window = rect(2400, 200, 2400, 1400);
        assert_eq!(
            clamp_target(window, &[PRIMARY], Some(PRIMARY)),
            Some((PRIMARY.x, PRIMARY.y))
        );
    }
}
