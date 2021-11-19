
<template>
	<div id="app" class="app">
		<router-view class="view" />
	</div>
</template>

<script lang="ts">
import { Component, Vue } from "vue-property-decorator";

@Component
export default class App extends Vue {

	public async mounted():Promise<void> {
		
	}

	public beforeDestroy():void {
	}

}
</script>

<style scoped lang="less">
.app{
	color: @mainColor_dark;
	height: 100%;

	.view {
		height: 100%;
	}
}
</style>