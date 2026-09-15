const BASE = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * canary 版本 = base 的 patch + 1 加上 prerelease 后缀，因此排在 base 之上、
 * 下一个正式版之下：0.23.0 < 0.23.1-canary.4213.a1b2c3d < 0.23.1 < 0.24.0。
 * 用 base 自身做 prerelease（0.23.0-canary.*）会排在 0.23.0 之下，令 canary
 * 用户被 update-notify 劝回已发布版本。
 */
export function canaryVersion({ base, runNumber, sha }: { base: string; runNumber: string; sha: string }): string {
  const parsed = BASE.exec(base);
  if (!parsed) throw new Error(`Invalid base version: ${base}`);
  if (!/^\d+$/.test(runNumber)) throw new Error(`Invalid run number: ${runNumber}`);
  if (!/^[0-9a-f]{7,40}$/.test(sha)) throw new Error(`Invalid commit sha: ${sha}`);

  const [, major, minor, patch] = parsed;
  // Number() 去掉前导零：semver 的数字型 prerelease 标识符不允许前导零。
  return `${major}.${minor}.${Number(patch) + 1}-canary.${Number(runNumber)}.${sha.slice(0, 7)}`;
}
