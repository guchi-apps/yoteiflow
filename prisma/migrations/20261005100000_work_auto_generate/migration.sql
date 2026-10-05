-- 勤務記録から勤務予定・通勤/出張移動を自動生成する（#1081）。
ALTER TABLE `UiSetting`
  ADD COLUMN `workAutoGenerate` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `workStartMinutes` INTEGER NOT NULL DEFAULT 525,
  ADD COLUMN `workEndMinutes` INTEGER NOT NULL DEFAULT 1035,
  ADD COLUMN `workLunchStartMinutes` INTEGER NOT NULL DEFAULT 720,
  ADD COLUMN `workLunchEndMinutes` INTEGER NOT NULL DEFAULT 780,
  ADD COLUMN `workCalendarId` VARCHAR(191) NULL,
  ADD COLUMN `workRemotePlaces` JSON NULL;

CREATE TABLE `WorkRouteDefault` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `origin` VARCHAR(191) NOT NULL,
  `destination` VARCHAR(191) NOT NULL,
  `mode` ENUM('CAR', 'PUBLIC_TRANSIT', 'WALK', 'OTHER') NOT NULL DEFAULT 'PUBLIC_TRANSIT',
  `minutes` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `WorkRouteDefault_userId_origin_destination_key`(`userId`, `origin`, `destination`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `WorkGenerated` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `workRecordId` VARCHAR(191) NOT NULL,
  `date` VARCHAR(191) NOT NULL,
  `kind` ENUM('WORK', 'OUTBOUND', 'RETURN') NOT NULL,
  `status` ENUM('ACTIVE', 'MANUAL') NOT NULL DEFAULT 'ACTIVE',
  `googleCalendarId` VARCHAR(191) NULL,
  `googleEventId` VARCHAR(191) NULL,
  `travelPlanId` VARCHAR(191) NULL,
  `snapshot` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `WorkGenerated_userId_workRecordId_idx`(`userId`, `workRecordId`),
  UNIQUE INDEX `WorkGenerated_userId_workRecordId_date_kind_key`(`userId`, `workRecordId`, `date`, `kind`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `WorkRouteDefault` ADD CONSTRAINT `WorkRouteDefault_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `WorkGenerated` ADD CONSTRAINT `WorkGenerated_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
