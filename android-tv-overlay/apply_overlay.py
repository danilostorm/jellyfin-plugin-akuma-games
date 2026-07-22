#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    content = path.read_text(encoding="utf-8")
    if old not in content:
        raise RuntimeError(f"Pattern not found in {path}: {old[:120]!r}")
    if content.count(old) != 1:
        raise RuntimeError(f"Pattern appears {content.count(old)} times in {path}: {old[:120]!r}")
    path.write_text(content.replace(old, new, 1), encoding="utf-8")


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: apply_overlay.py <jellyfin-androidtv-root>", file=sys.stderr)
        return 2

    root = Path(sys.argv[1]).resolve()
    if not (root / "app").is_dir():
        raise RuntimeError(f"Invalid Jellyfin Android TV source tree: {root}")

    manifest = root / "app/src/main/AndroidManifest.xml"
    replace_once(
        manifest,
        '''        <activity
            android:name=".ui.preference.PreferencesActivity"
            android:theme="@style/Theme.Jellyfin.Preferences" />''',
        '''        <activity
            android:name=".ui.games.AkumaGamesActivity"
            android:exported="false"
            android:hardwareAccelerated="true"
            android:screenOrientation="landscape"
            android:theme="@style/Theme.Jellyfin"
            android:windowSoftInputMode="adjustNothing" />

        <activity
            android:name=".ui.preference.PreferencesActivity"
            android:theme="@style/Theme.Jellyfin.Preferences" />''',
    )

    activity_destinations = root / "app/src/main/java/org/jellyfin/androidtv/ui/navigation/ActivityDestinations.kt"
    replace_once(
        activity_destinations,
        "import org.jellyfin.androidtv.ui.livetv.GuideOptionsScreen\n",
        "import org.jellyfin.androidtv.ui.livetv.GuideOptionsScreen\nimport org.jellyfin.androidtv.ui.games.AkumaGamesActivity\n",
    )
    replace_once(
        activity_destinations,
        '''\tfun userPreferences(context: Context) = preferenceIntent<UserPreferencesScreen>(context)
''',
        '''\tfun userPreferences(context: Context) = preferenceIntent<UserPreferencesScreen>(context)
\tfun akumaGames(context: Context) = Intent(context, AkumaGamesActivity::class.java)
''',
    )

    toolbar = root / "app/src/main/java/org/jellyfin/androidtv/ui/shared/toolbar/MainToolbar.kt"
    replace_once(
        toolbar,
        '''\tHome,
\tSearch,

\tNone,''',
        '''\tHome,
\tSearch,
\tGames,

\tNone,''',
    )
    replace_once(
        toolbar,
        '''\t\t\t\t\tButton(
\t\t\t\t\t\tonClick = {
\t\t\t\t\t\t\tif (activeButton != MainToolbarActiveButton.Search) {
\t\t\t\t\t\t\t\tnavigationRepository.navigate(Destinations.search())
\t\t\t\t\t\t\t}
\t\t\t\t\t\t},
\t\t\t\t\t\tcolors = if (activeButton == MainToolbarActiveButton.Search) activeButtonColors else ButtonDefaults.colors(),
\t\t\t\t\t\tcontent = { Text(stringResource(R.string.lbl_search)) }
\t\t\t\t\t)
''',
        '''\t\t\t\t\tButton(
\t\t\t\t\t\tonClick = {
\t\t\t\t\t\t\tif (activeButton != MainToolbarActiveButton.Search) {
\t\t\t\t\t\t\t\tnavigationRepository.navigate(Destinations.search())
\t\t\t\t\t\t\t}
\t\t\t\t\t\t},
\t\t\t\t\t\tcolors = if (activeButton == MainToolbarActiveButton.Search) activeButtonColors else ButtonDefaults.colors(),
\t\t\t\t\t\tcontent = { Text(stringResource(R.string.lbl_search)) }
\t\t\t\t\t)
\t\t\t\t\tButton(
\t\t\t\t\t\tonClick = {
\t\t\t\t\t\t\tactivity?.let { context ->
\t\t\t\t\t\t\t\tcontext.startActivity(ActivityDestinations.akumaGames(context))
\t\t\t\t\t\t\t}
\t\t\t\t\t\t},
\t\t\t\t\t\tcolors = if (activeButton == MainToolbarActiveButton.Games) activeButtonColors else ButtonDefaults.colors(),
\t\t\t\t\t\tcontent = { Text(stringResource(R.string.lbl_akuma_games)) }
\t\t\t\t\t)
''',
    )

    home_rows = root / "app/src/main/java/org/jellyfin/androidtv/ui/home/HomeRowsFragment.kt"
    replace_once(
        home_rows,
        "import org.jellyfin.androidtv.ui.navigation.NavigationRepository\n",
        "import org.jellyfin.androidtv.ui.navigation.ActivityDestinations\nimport org.jellyfin.androidtv.ui.navigation.NavigationRepository\n",
    )
    replace_once(
        home_rows,
        '''\t\t\tif (item !is BaseRowItem) return
\t\t\tif (row !is ListRow) return
\t\t\t@Suppress("UNCHECKED_CAST")
\t\t\titemLauncher.launch(item, row.adapter as MutableObjectAdapter<Any>, requireContext())
''',
        '''\t\t\tif (item !is BaseRowItem) return
\t\t\tif (row !is ListRow) return

\t\t\tif (item.baseItem?.name.equals("Games", ignoreCase = true)) {
\t\t\t\trequireContext().startActivity(ActivityDestinations.akumaGames(requireContext()))
\t\t\t\treturn
\t\t\t}

\t\t\t@Suppress("UNCHECKED_CAST")
\t\t\titemLauncher.launch(item, row.adapter as MutableObjectAdapter<Any>, requireContext())
''',
    )

    strings = root / "app/src/main/res/values/strings.xml"
    replace_once(
        strings,
        '<string name="app_name_debug" translatable="false" tools:ignore="UnusedResources">Jellyfin Debug</string>',
        '<string name="app_name_debug" translatable="false" tools:ignore="UnusedResources">Jellyfin Akuma Games</string>',
    )

    print("Akuma Games Android TV overlay applied successfully.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
