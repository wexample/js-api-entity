from __future__ import annotations

from wexample_config.const.types import DictConfig
from wexample_wex_addon_dev_javascript.workdir.javascript_package_workdir import JavascriptPackageWorkdir


class AppWorkdir(JavascriptPackageWorkdir):
    def get_public_remote_repository_url(self) -> str | None:
        from wexample_helpers.helper.string import string_to_kebab_case

        name_config = self.get_runtime_config().search("global.name")
        return f"https://github.com/wexample/{string_to_kebab_case(name_config.get_str())}"

    def prepare_value(self, raw_value: DictConfig | None = None) -> DictConfig:
        from wexample_helpers.helper.string import string_to_kebab_case

        raw_value = super().prepare_value(raw_value=raw_value)
        name_config = self.get_runtime_config().search("global.name")

        def _build_remote_github(target: AppWorkdir) -> str:
            return f"git@github.com:wexample/{string_to_kebab_case(name_config.get_str())}.git"

        def _build_remote_gitlab(target: AppWorkdir) -> str:
            return f"ssh://git@gitlab.wexample.com:4567/wexample-javascript/{string_to_kebab_case(name_config.get_str())}.git"

        raw_value["git"] = {
            "main_branch": "main",
            "remote": [
                {
                    "name": "origin",
                    "type": "gitlab",
                    "url": _build_remote_gitlab,
                    "create_remote": True,
                },
                {
                    "name": "github",
                    "type": "github",
                    "url": _build_remote_github,
                    "create_remote": True,
                },
            ]
        }

        return raw_value
