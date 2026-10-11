using System.Runtime.InteropServices;

namespace Bloxboard.Companion.App;

/// <summary>Plain Windows window APIs (dragging, hotkey, rounded corners). Nothing touches Roblox.</summary>
static partial class Native
{
    public const int WM_NCLBUTTONDOWN = 0xA1;
    public const int HTCAPTION = 0x2;
    public const int WM_HOTKEY = 0x0312;
    public const uint MOD_CONTROL = 0x2, MOD_SHIFT = 0x4, MOD_NOREPEAT = 0x4000;
    public const int WS_EX_TOOLWINDOW = 0x80;
    public const int WS_EX_TOPMOST = 0x8;

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool ReleaseCapture();

    [LibraryImport("user32.dll", EntryPoint = "SendMessageW")]
    public static partial IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool RegisterHotKey(IntPtr hWnd, int id, uint modifiers, uint vk);

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool UnregisterHotKey(IntPtr hWnd, int id);

    [LibraryImport("dwmapi.dll")]
    public static partial int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    public static void DragWindow(Control c)
    {
        ReleaseCapture();
        SendMessage(c.FindForm()!.Handle, WM_NCLBUTTONDOWN, HTCAPTION, IntPtr.Zero);
    }

    public static void RoundCorners(IntPtr hwnd)
    {
        int round = 2; // DWMWCP_ROUND (Windows 11; ignored on Windows 10)
        try { DwmSetWindowAttribute(hwnd, 33, ref round, sizeof(int)); } catch { /* older Windows */ }
    }
}
