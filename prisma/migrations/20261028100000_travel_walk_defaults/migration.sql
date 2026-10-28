-- Yahoo!乗換案内の取り込みで、電車の発着の前後に足す徒歩の分（#1463）。
ALTER TABLE `UiSetting` ADD COLUMN `travelWalkBeforeMinutes` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `travelWalkAfterMinutes` INTEGER NOT NULL DEFAULT 0;
