using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: AssemblyTitle("Instalador do Ponto")]
[assembly: AssemblyProduct("Ponto para WhatsApp Web")]

internal static class PontoInstaller
{
    private const string ProductName = "Ponto para WhatsApp Web";
    private const string OwnerMarker = ".ponto-install";
    private const string MarkerValue = "Simpnick/ponto-whatsapp Windows installer";

    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        try
        {
            var localData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string folder;
            using (var payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("Ponto.Extension.zip"))
                folder = PrepareAt(Path.Combine(localData, "Ponto"), payload);

            var chrome = FindChrome(localData);
            var opened = OpenChrome(chrome);
            Application.Run(CreateInstructions(folder, chrome, opened));
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Não foi possível preparar o Ponto", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Environment.ExitCode = 1;
        }
    }

    internal static string PrepareAt(string root, Stream payload)
    {
        if (payload == null) throw new InvalidDataException("O instalador está sem o pacote da extensão.");
        if (!Path.IsPathRooted(root)) throw new InvalidDataException("A pasta de instalação precisa ser absoluta.");
        root = Path.GetFullPath(root);
        Directory.CreateDirectory(root);
        RequireRegularPath(root);
        var lockPath = Path.Combine(root, ".install.lock");
        if (File.Exists(lockPath)) RequireRegularPath(lockPath);

        using (new FileStream(lockPath, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None))
        {
            var destination = Path.Combine(root, "ChromeExtension");
            var backup = Path.Combine(root, ".previous");
            var staging = Path.Combine(root, ".setup-" + Guid.NewGuid().ToString("N"));
            if (Directory.Exists(backup))
            {
                RequireOwnedFolder(backup);
                if (Directory.Exists(destination))
                {
                    RequireOwnedFolder(destination);
                    Directory.Delete(backup, true);
                }
                else Directory.Move(backup, destination);
            }

            try
            {
                Directory.CreateDirectory(staging);
                Extract(payload, staging);
                var newVersion = ReadVersion(staging);
                File.WriteAllText(Path.Combine(staging, OwnerMarker), MarkerValue);

                if (Directory.Exists(destination))
                {
                    RequireOwnedFolder(destination);
                    if (ReadVersion(destination) > newVersion)
                        throw new InvalidOperationException("Já existe uma versão mais recente do Ponto nesta pasta.");
                    Directory.Move(destination, backup);
                }

                try { Directory.Move(staging, destination); }
                catch
                {
                    if (Directory.Exists(backup) && !Directory.Exists(destination)) Directory.Move(backup, destination);
                    throw;
                }
                TryCleanup(backup);
                return destination;
            }
            finally { TryCleanup(staging); }
        }
    }

    private static void Extract(Stream payload, string folder)
    {
        var boundary = folder + Path.DirectorySeparatorChar;
        using (var archive = new ZipArchive(payload, ZipArchiveMode.Read, true))
        {
            foreach (var entry in archive.Entries)
            {
                var path = Path.GetFullPath(Path.Combine(folder, entry.FullName));
                if (!path.StartsWith(boundary, StringComparison.OrdinalIgnoreCase) || entry.FullName.Contains(":"))
                    throw new InvalidDataException("O pacote contém um caminho inválido.");
                if (entry.Name.Length == 0) Directory.CreateDirectory(path);
                else
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(path));
                    using (var input = entry.Open())
                    using (var output = new FileStream(path, FileMode.CreateNew, FileAccess.Write)) input.CopyTo(output);
                }
            }
        }
    }

    private static Version ReadVersion(string folder)
    {
        var manifest = new JavaScriptSerializer().DeserializeObject(File.ReadAllText(Path.Combine(folder, "manifest.json")))
            as System.Collections.Generic.Dictionary<string, object>;
        object name, manifestVersion, rawVersion;
        Version version;
        if (manifest == null || !manifest.TryGetValue("name", out name) || !ProductName.Equals(name) ||
            !manifest.TryGetValue("manifest_version", out manifestVersion) || !Equals(3, manifestVersion) ||
            !manifest.TryGetValue("version", out rawVersion) || !Version.TryParse(rawVersion as string, out version))
            throw new InvalidDataException("O pacote não contém um manifesto válido do Ponto.");
        return version;
    }

    private static void RequireOwnedFolder(string path)
    {
        RequireRegularTree(path);
        var marker = Path.Combine(path, OwnerMarker);
        if (!File.Exists(marker) || File.ReadAllText(marker) != MarkerValue)
            throw new IOException("A pasta de destino contém arquivos de outra instalação. " + path);
    }

    private static void RequireRegularPath(string path)
    {
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
            throw new IOException("A pasta de instalação contém um redirecionamento. " + path);
    }

    private static void RequireRegularTree(string path)
    {
        RequireRegularPath(path);
        foreach (var entry in Directory.EnumerateFileSystemEntries(path))
        {
            RequireRegularPath(entry);
            if (Directory.Exists(entry)) RequireRegularTree(entry);
        }
    }

    private static void TryCleanup(string path)
    {
        if (!Directory.Exists(path)) return;
        try
        {
            RequireRegularTree(path);
            Directory.Delete(path, true);
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    private static string FindChrome(string localData)
    {
        var roots = new[] { Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), localData };
        foreach (var root in roots)
        {
            if (string.IsNullOrEmpty(root)) continue;
            var path = Path.Combine(root, "Google", "Chrome", "Application", "chrome.exe");
            if (File.Exists(path)) return path;
        }
        return null;
    }

    private static bool OpenChrome(string chrome)
    {
        if (chrome == null) return false;
        try
        {
            Process.Start(new ProcessStartInfo(chrome, "chrome://extensions/") { UseShellExecute = true });
            return true;
        }
        catch (System.ComponentModel.Win32Exception) { return false; }
    }

    private static Form CreateInstructions(string folder, string chrome, bool opened)
    {
        var form = new Form { Text = "Instalador do Ponto", StartPosition = FormStartPosition.CenterScreen,
            ClientSize = new Size(590, 232), FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false, MinimizeBox = false, Font = new Font("Segoe UI", 10), BackColor = Color.White,
            AutoScaleMode = AutoScaleMode.Dpi };
        var title = new Label { Text = "Ponto pronto para carregar", ForeColor = Color.FromArgb(21, 77, 55),
            Font = new Font(form.Font.FontFamily, 15, FontStyle.Bold), Bounds = new Rectangle(16, 14, 550, 29) };
        var instructions = new Label { Bounds = new Rectangle(18, 49, 555, 87), Text =
            (opened ? "O Chrome abriu a página de extensões." : "Abra chrome://extensions em um Chrome atualizado.") +
            "\r\nNa primeira instalação, ative o Modo do desenvolvedor e clique em Carregar sem compactação. Cole a pasta abaixo." +
            "\r\nPara atualizar, clique em Recarregar no cartão do Ponto e recarregue o WhatsApp Web." };
        var path = new TextBox { Text = folder, ReadOnly = true, Bounds = new Rectangle(18, 140, 555, 28) };
        var copy = new Button { Text = "Copiar pasta", Bounds = new Rectangle(18, 182, 120, 33) };
        copy.Click += delegate
        {
            try { Clipboard.SetText(folder); copy.Text = "Pasta copiada"; }
            catch (ExternalException) { path.Focus(); path.SelectAll(); }
        };
        var browser = new Button { Text = "Abrir extensões", Bounds = new Rectangle(147, 182, 155, 33), Enabled = chrome != null };
        browser.Click += delegate { OpenChrome(chrome); };
        var close = new Button { Text = "Fechar", Bounds = new Rectangle(473, 182, 100, 33), DialogResult = DialogResult.Cancel };
        close.Click += delegate { form.Close(); };
        form.CancelButton = close;
        form.Controls.AddRange(new Control[] { title, instructions, path, copy, browser, close });
        return form;
    }
}
