import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import {
  CandlestickChart, LineChart, BarChart,
} from 'echarts/charts'
import {
  TitleComponent, TooltipComponent, GridComponent, LegendComponent,
  DataZoomComponent, MarkLineComponent,
} from 'echarts/components'

use([
  CanvasRenderer,
  CandlestickChart, LineChart, BarChart,
  TitleComponent, TooltipComponent, GridComponent, LegendComponent,
  DataZoomComponent, MarkLineComponent,
])
