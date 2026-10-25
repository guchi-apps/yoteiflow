-- 狭い月表示の勤務バッジに出す、勤務場所ごとの1文字（#1381）。
ALTER TABLE `NotionConnection` ADD COLUMN `workPlaceShortLabels` JSON NULL;
