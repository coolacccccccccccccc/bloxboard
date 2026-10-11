namespace Bloxboard.Companion.App;

static class Theme
{
    public static readonly Color Bg = Color.FromArgb(20, 22, 29);
    public static readonly Color Panel = Color.FromArgb(31, 34, 44);
    public static readonly Color Hover = Color.FromArgb(44, 48, 62);
    public static readonly Color Text = Color.FromArgb(236, 238, 244);
    public static readonly Color Muted = Color.FromArgb(154, 160, 180);
    public static readonly Color Accent = Color.FromArgb(124, 140, 255);
    public static readonly Color Good = Color.FromArgb(53, 201, 141);
    public static readonly Color Line = Color.FromArgb(44, 47, 58);

    private static readonly FontFamily Family = PickFamily();

    private static FontFamily PickFamily()
    {
        foreach (var name in new[] { "Segoe UI", "Segoe UI Variable Text", "Tahoma" })
        {
            try { return new FontFamily(name); } catch (ArgumentException) { }
        }
        return SystemFonts.MessageBoxFont?.FontFamily ?? FontFamily.GenericSansSerif;
    }

    public static Font Font(float size, FontStyle style = FontStyle.Regular) => new(Family, size, style);

    public static Icon AppIcon()
    {
        using var s = typeof(Theme).Assembly.GetManifestResourceStream("bloxboard.ico");
        return s is null ? SystemIcons.Application : new Icon(s);
    }

    public static Button Button(string text, bool primary = false)
    {
        var b = new Button
        {
            Text = text,
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            FlatStyle = FlatStyle.Flat,
            BackColor = primary ? Accent : Panel,
            ForeColor = primary ? Bg : Text,
            Font = Font(9f, FontStyle.Bold),
            Padding = new Padding(8, 3, 8, 3),
            Margin = new Padding(0, 0, 6, 6),
            Cursor = Cursors.Hand,
            TabStop = false,
        };
        b.FlatAppearance.BorderSize = 0;
        b.FlatAppearance.MouseOverBackColor = primary ? ControlPaint.Light(Accent) : Hover;
        return b;
    }

    public static Label Label(string text, float size, Color color, FontStyle style = FontStyle.Regular) => new()
    {
        Text = text,
        AutoSize = true,
        ForeColor = color,
        Font = Font(size, style),
        BackColor = Color.Transparent,
        UseMnemonic = false,
    };
}
