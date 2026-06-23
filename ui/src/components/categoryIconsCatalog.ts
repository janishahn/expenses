import type { PhosphorIcon } from "./phosphorUtils"
import { HouseIcon } from "@phosphor-icons/react/House"
import { CoffeeIcon } from "@phosphor-icons/react/Coffee"
import { CarIcon } from "@phosphor-icons/react/Car"
import { HeartIcon } from "@phosphor-icons/react/Heart"
import { MusicNotesIcon } from "@phosphor-icons/react/MusicNotes"
import { ShoppingCartIcon } from "@phosphor-icons/react/ShoppingCart"
import { LightningIcon } from "@phosphor-icons/react/Lightning"
import { BriefcaseIcon } from "@phosphor-icons/react/Briefcase"
import { AirplaneIcon } from "@phosphor-icons/react/Airplane"
import { ForkKnifeIcon } from "@phosphor-icons/react/ForkKnife"
import { PiggyBankIcon } from "@phosphor-icons/react/PiggyBank"
import { GraduationCapIcon } from "@phosphor-icons/react/GraduationCap"
import { GiftIcon } from "@phosphor-icons/react/Gift"
import { ScissorsIcon } from "@phosphor-icons/react/Scissors"
import { TShirtIcon } from "@phosphor-icons/react/TShirt"
import { BarbellIcon } from "@phosphor-icons/react/Barbell"
import { FilmStripIcon } from "@phosphor-icons/react/FilmStrip"
import { GameControllerIcon } from "@phosphor-icons/react/GameController"
import { BookIcon } from "@phosphor-icons/react/Book"
import { WifiHighIcon } from "@phosphor-icons/react/WifiHigh"
import { DeviceMobileIcon } from "@phosphor-icons/react/DeviceMobile"
import { CreditCardIcon } from "@phosphor-icons/react/CreditCard"
import { ReceiptIcon } from "@phosphor-icons/react/Receipt"
import { MoneyIcon } from "@phosphor-icons/react/Money"
import { TrendUpIcon } from "@phosphor-icons/react/TrendUp"
import { BuildingsIcon } from "@phosphor-icons/react/Buildings"
import { BabyIcon } from "@phosphor-icons/react/Baby"
import { DogIcon } from "@phosphor-icons/react/Dog"
import { StethoscopeIcon } from "@phosphor-icons/react/Stethoscope"
import { PaletteIcon } from "@phosphor-icons/react/Palette"
import { BusIcon } from "@phosphor-icons/react/Bus"
import { GasPumpIcon } from "@phosphor-icons/react/GasPump"
import { PackageIcon } from "@phosphor-icons/react/Package"
import { GlobeIcon } from "@phosphor-icons/react/Globe"
import { CurrencyCircleDollarIcon } from "@phosphor-icons/react/CurrencyCircleDollar"

export const DEFAULT_CATEGORY_ICON_KEY = "currency-circle-dollar"

export const CURATED_CATEGORY_ICONS: Record<string, PhosphorIcon> = {
  house: HouseIcon,
  coffee: CoffeeIcon,
  car: CarIcon,
  heart: HeartIcon,
  "music-notes": MusicNotesIcon,
  "shopping-cart": ShoppingCartIcon,
  lightning: LightningIcon,
  briefcase: BriefcaseIcon,
  airplane: AirplaneIcon,
  "fork-knife": ForkKnifeIcon,
  "piggy-bank": PiggyBankIcon,
  "graduation-cap": GraduationCapIcon,
  gift: GiftIcon,
  scissors: ScissorsIcon,
  "t-shirt": TShirtIcon,
  barbell: BarbellIcon,
  "film-strip": FilmStripIcon,
  "game-controller": GameControllerIcon,
  book: BookIcon,
  "wifi-high": WifiHighIcon,
  "device-mobile": DeviceMobileIcon,
  "credit-card": CreditCardIcon,
  receipt: ReceiptIcon,
  money: MoneyIcon,
  "trend-up": TrendUpIcon,
  buildings: BuildingsIcon,
  baby: BabyIcon,
  dog: DogIcon,
  stethoscope: StethoscopeIcon,
  palette: PaletteIcon,
  bus: BusIcon,
  "gas-pump": GasPumpIcon,
  package: PackageIcon,
  globe: GlobeIcon,
  [DEFAULT_CATEGORY_ICON_KEY]: CurrencyCircleDollarIcon,
}
