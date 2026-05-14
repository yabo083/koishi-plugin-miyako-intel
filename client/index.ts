import { Context } from '@koishijs/client'
import MiyakoIntelDetails from './MiyakoIntelDetails.vue'

export default (ctx: Context) => {
  ctx.slot({
    type: 'plugin-details',
    component: MiyakoIntelDetails,
    order: -700,
  })
}
