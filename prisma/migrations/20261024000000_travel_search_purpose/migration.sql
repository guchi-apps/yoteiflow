-- 予定前後の移動を探すときの余裕分の既定値と、移動ごとの検索の意図（#1331）。
ALTER TABLE `UiSetting` ADD COLUMN `travelArriveMarginMinutes` INTEGER NOT NULL DEFAULT 15;

ALTER TABLE `TravelPlan`
  ADD COLUMN `searchPurpose` ENUM('BEFORE_EVENT', 'AFTER_EVENT') NULL,
  ADD COLUMN `searchMarginMinutes` INTEGER NULL;
