using System.Diagnostics;

namespace Bloxboard.Companion.App;

/// <summary>List of servers you played in, with Rejoin and Copy invite.</summary>
sealed class RecentForm : Form
{
    public RecentForm(List<Session> history)
    {
        Text = "Recent servers · Bloxboard";
        Icon = Theme.AppIcon();
        BackColor = Theme.Bg;
        ForeColor = Theme.Text;
        Font = Theme.Font(9.5f);
        StartPosition = FormStartPosition.CenterScreen;
        Size = new Size(560, 600);
        MinimumSize = new Size(420, 300);

        var list = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoScroll = true, FlowDirection = FlowDirection.TopDown, WrapContents = false, Padding = new Padding(16), BackColor = Theme.Bg };
        Controls.Add(list);

        if (history.Count == 0)
        {
            list.Controls.Add(Theme.Label("No servers yet. Play a game with the companion running and they show up here.", 10f, Theme.Muted));
            return;
        }

        foreach (var s in history.Take(50))
        {
            var row = new TableLayoutPanel { ColumnCount = 3, RowCount = 1, Width = 500, AutoSize = true, BackColor = Theme.Panel, Padding = new Padding(10, 8, 10, 8), Margin = new Padding(0, 0, 0, 8) };
            row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            row.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            row.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));

            var text = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, AutoSize = true, WrapContents = false, BackColor = Color.Transparent };
            var name = Theme.Label(string.IsNullOrEmpty(s.GameName) ? $"Place {s.PlaceId}" : s.GameName, 10f, Theme.Text, FontStyle.Bold);
            name.MaximumSize = new Size(300, 0);
            var mins = (int)((s.LeftAt ?? DateTime.Now) - s.JoinedAt).TotalMinutes;
            var when = s.JoinedAt.ToString("ddd d MMM, HH:mm");
            var detail = Theme.Label($"{when} · {mins} min{(string.IsNullOrEmpty(s.Location) ? "" : $" · {s.Location}")}", 8.5f, Theme.Muted);
            text.Controls.Add(name);
            text.Controls.Add(detail);

            var copy = Theme.Button("Copy invite");
            copy.Click += (_, _) => { try { Clipboard.SetText(RobloxApi.InviteUrl(s.PlaceId, s.JobId)); copy.Text = "Copied"; } catch { copy.Text = "Failed"; } };
            var join = Theme.Button("Rejoin", primary: true);
            join.Click += (_, _) => { try { Process.Start(new ProcessStartInfo(RobloxApi.JoinUrl(s.PlaceId, s.JobId)) { UseShellExecute = true }); } catch { } };

            row.Controls.Add(text, 0, 0);
            row.Controls.Add(copy, 1, 0);
            row.Controls.Add(join, 2, 0);
            list.Controls.Add(row);
        }
        list.Controls.Add(Theme.Label("Servers close when everyone leaves, so older ones may be gone.", 8.5f, Theme.Muted));
    }
}
